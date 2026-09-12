import { all, get, run, tx } from '../db/index.js';
import * as leadRepo from '../repositories/leadRepo.js';
import ActivityService from './ActivityService.js';
import ScoreService from './ScoreService.js';
import { bus, EVENTOS } from '../realtime/bus.js';
import { AppError } from '../utils/errors.js';

/**
 * Vendas e financeiro (spec 71).
 * Fechar uma venda move o lead para FECHADO e mantem todo o historico.
 */
export const STATUS_VENDA = ['PENDENTE', 'PARCIAL', 'PAGO', 'ATRASADO', 'CANCELADO'];
export const STATUS_PAGAMENTO = ['PENDENTE', 'PAGO', 'ATRASADO', 'CANCELADO'];

export const porId = (id) => get('SELECT * FROM sales WHERE id = ?', id);

export const listar = ({ status = null, limite = 200 } = {}) =>
  all(
    `SELECT s.*, l.nome_estabelecimento, l.cidade, l.nicho, l.telefone_e164,
            (SELECT COALESCE(SUM(p.valor), 0) FROM payments p WHERE p.sale_id = s.id AND p.status = 'PAGO') AS recebido
       FROM sales s JOIN leads l ON l.id = s.lead_id
      ${status ? 'WHERE s.status = ?' : ''}
      ORDER BY s.data_venda DESC, s.id DESC LIMIT ?`,
    ...(status ? [status] : []),
    limite
  );

export const pagamentos = (saleId) => all('SELECT * FROM payments WHERE sale_id = ? ORDER BY data_prevista ASC, id ASC', saleId);

/** Registra a venda e, opcionalmente, as parcelas. */
export function registrar({
  leadId,
  valor,
  forma_pagamento = null,
  status = 'PENDENTE',
  descricao = null,
  observacoes = null,
  demo_id = null,
  campaign_id = null,
  parcelas = []
}) {
  const lead = leadRepo.porId(leadId);
  if (!lead) throw new AppError('Lead nao encontrado.', 404);
  const total = Number(valor);
  if (!Number.isFinite(total) || total <= 0) throw new AppError('Informe o valor da venda.');
  if (!STATUS_VENDA.includes(status)) throw new AppError('Status de venda invalido.');

  return tx(() => {
    const r = run(
      `INSERT INTO sales (lead_id, demo_id, campaign_id, descricao, valor, forma_pagamento, status, observacoes)
       VALUES (?,?,?,?,?,?,?,?)`,
      leadId, demo_id, campaign_id, descricao, total, forma_pagamento, status, observacoes
    );
    const venda = porId(Number(r.lastInsertRowid));

    for (const p of parcelas) {
      run(
        'INSERT INTO payments (sale_id, valor, data_prevista, status, forma, observacoes) VALUES (?,?,?,?,?,?)',
        venda.id,
        Number(p.valor) || 0,
        p.data_prevista || null,
        STATUS_PAGAMENTO.includes(p.status) ? p.status : 'PENDENTE',
        p.forma || forma_pagamento,
        p.observacoes || null
      );
    }

    leadRepo.atualizar(leadId, {
      status: 'FECHADO',
      pipeline: 'FECHADO',
      fechado_em: new Date().toISOString()
    });

    ActivityService.registrar({
      lead_id: leadId,
      tipo: 'VENDA',
      titulo: `Venda registrada · R$ ${total.toFixed(2)}`,
      descricao: descricao || forma_pagamento || null,
      meta: { sale_id: venda.id }
    });
    ActivityService.notificar({
      tipo: 'venda',
      titulo: `Venda fechada: ${lead.nome_estabelecimento}`,
      texto: `R$ ${total.toFixed(2)}${forma_pagamento ? ` · ${forma_pagamento}` : ''}`,
      lead_id: leadId,
      rota: '/vendas'
    });
    ScoreService.recalcular(leadId, { silencioso: true });
    bus.emit(EVENTOS.VENDA, venda);
    bus.emit(EVENTOS.STATS, {});
    return venda;
  });
}

export function atualizar(id, patch = {}) {
  const venda = porId(id);
  if (!venda) throw new AppError('Venda nao encontrada.', 404);
  const permitido = ['descricao', 'valor', 'forma_pagamento', 'status', 'observacoes', 'data_venda'];
  const entradas = Object.entries(patch).filter(([k]) => permitido.includes(k));
  if (!entradas.length) return venda;
  if (patch.status && !STATUS_VENDA.includes(patch.status)) throw new AppError('Status de venda invalido.');
  run(
    `UPDATE sales SET ${entradas.map(([k]) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
    ...entradas.map(([, v]) => v),
    id
  );
  bus.emit(EVENTOS.STATS, {});
  return porId(id);
}

export function registrarPagamento({ saleId, valor, data_pagamento = null, data_prevista = null, status = 'PAGO', forma = null, observacoes = null }) {
  const venda = porId(saleId);
  if (!venda) throw new AppError('Venda nao encontrada.', 404);
  if (!STATUS_PAGAMENTO.includes(status)) throw new AppError('Status de pagamento invalido.');

  run(
    'INSERT INTO payments (sale_id, valor, data_prevista, data_pagamento, status, forma, observacoes) VALUES (?,?,?,?,?,?,?)',
    saleId,
    Number(valor) || 0,
    data_prevista,
    status === 'PAGO' ? data_pagamento || new Date().toISOString().slice(0, 10) : data_pagamento,
    status,
    forma || venda.forma_pagamento,
    observacoes
  );

  sincronizarStatus(saleId);
  ActivityService.registrar({
    lead_id: venda.lead_id,
    tipo: 'PAGAMENTO',
    titulo: `Pagamento de R$ ${Number(valor || 0).toFixed(2)}`,
    meta: { sale_id: saleId }
  });
  bus.emit(EVENTOS.STATS, {});
  return { venda: porId(saleId), pagamentos: pagamentos(saleId) };
}

/**
 * Quita uma parcela que ja estava prevista, em vez de criar outra linha.
 * E o caminho normal: "essa parcela entrou".
 */
export function quitarParcela(paymentId, { data_pagamento = null, forma = null } = {}) {
  const p = get('SELECT * FROM payments WHERE id = ?', paymentId);
  if (!p) throw new AppError('Parcela nao encontrada.', 404);
  if (p.status === 'PAGO') return { venda: porId(p.sale_id), pagamentos: pagamentos(p.sale_id) };

  run(
    "UPDATE payments SET status = 'PAGO', data_pagamento = ?, forma = COALESCE(?, forma) WHERE id = ?",
    data_pagamento || new Date().toISOString().slice(0, 10),
    forma,
    paymentId
  );
  sincronizarStatus(p.sale_id);

  const venda = porId(p.sale_id);
  ActivityService.registrar({
    lead_id: venda.lead_id,
    tipo: 'PAGAMENTO',
    titulo: `Parcela de R$ ${Number(p.valor || 0).toFixed(2)} recebida`,
    meta: { sale_id: venda.id, payment_id: paymentId }
  });
  bus.emit(EVENTOS.STATS, {});
  return { venda, pagamentos: pagamentos(venda.id) };
}

export function excluirParcela(paymentId) {
  const p = get('SELECT * FROM payments WHERE id = ?', paymentId);
  if (!p) throw new AppError('Parcela nao encontrada.', 404);
  run('DELETE FROM payments WHERE id = ?', paymentId);
  sincronizarStatus(p.sale_id);
  return { ok: true };
}

/** Status da venda derivado do quanto ja foi recebido. */
export function sincronizarStatus(saleId) {
  const venda = porId(saleId);
  if (!venda || venda.status === 'CANCELADO') return venda;
  const recebido = Number(
    get("SELECT COALESCE(SUM(valor), 0) AS v FROM payments WHERE sale_id = ? AND status = 'PAGO'", saleId)?.v || 0
  );
  let status = 'PENDENTE';
  if (recebido >= Number(venda.valor)) status = 'PAGO';
  else if (recebido > 0) status = 'PARCIAL';
  run("UPDATE sales SET status = ?, updated_at = datetime('now') WHERE id = ?", status, saleId);
  return porId(saleId);
}

export function excluir(id) {
  const venda = porId(id);
  if (!venda) throw new AppError('Venda nao encontrada.', 404);
  run('DELETE FROM sales WHERE id = ?', id);
  bus.emit(EVENTOS.STATS, {});
  return { ok: true, historicoPreservado: true };
}

/** Metricas do financeiro (spec 71). */
export function metricas() {
  const v = get(`
    SELECT
      COUNT(*) AS vendas,
      COALESCE(SUM(valor), 0) AS faturamento,
      COALESCE(AVG(valor), 0) AS ticket_medio,
      SUM(CASE WHEN status = 'PAGO' THEN 1 ELSE 0 END) AS pagas,
      SUM(CASE WHEN status = 'ATRASADO' THEN 1 ELSE 0 END) AS atrasadas
    FROM sales WHERE status <> 'CANCELADO'`);
  const recebido = Number(get("SELECT COALESCE(SUM(valor),0) AS v FROM payments WHERE status = 'PAGO'")?.v || 0);
  const faturamento = Number(v?.faturamento || 0);
  return {
    vendas: Number(v?.vendas || 0),
    faturamento,
    recebido,
    pendente: Math.max(0, faturamento - recebido),
    ticket_medio: Number(Number(v?.ticket_medio || 0).toFixed(2)),
    pagas: Number(v?.pagas || 0),
    atrasadas: Number(v?.atrasadas || 0)
  };
}

export const serieFaturamento = (meses = 6) =>
  all(
    `SELECT strftime('%Y-%m', data_venda) AS mes,
            COUNT(*) AS vendas,
            COALESCE(SUM(valor), 0) AS total
       FROM sales
      WHERE status <> 'CANCELADO' AND data_venda >= date('now', ?)
      GROUP BY mes ORDER BY mes ASC`,
    `-${Math.max(1, Number(meses) || 6)} months`
  );

export default {
  registrar, atualizar, registrarPagamento, quitarParcela, excluirParcela, sincronizarStatus,
  excluir, listar, porId, pagamentos, metricas, serieFaturamento, STATUS_VENDA, STATUS_PAGAMENTO
};
