import { all, get, run } from '../db/index.js';
import * as leadRepo from '../repositories/leadRepo.js';
import ActivityService from './ActivityService.js';
import ScoreService from './ScoreService.js';
import { bus, EVENTOS } from '../realtime/bus.js';
import { AppError } from '../utils/errors.js';

/**
 * Demonstracoes (spec 68).
 * Pipeline: sem demo -> criada -> enviada -> acessada -> feedback -> negociacao -> fechada.
 * A demo e o gatilho central da Skill ("ja criei um modelo para voces").
 */
export const ETAPAS = [
  { slug: 'CRIADA', nome: 'Criada', cor: '#38bdf8' },
  { slug: 'ENVIADA', nome: 'Enviada', cor: '#a855f7' },
  { slug: 'ACESSADA', nome: 'Acessada', cor: '#22c55e' },
  { slug: 'FEEDBACK', nome: 'Com feedback', cor: '#f97316' },
  { slug: 'NEGOCIACAO', nome: 'Em negociacao', cor: '#eab308' },
  { slug: 'FECHADA', nome: 'Fechada', cor: '#14b8a6' },
  { slug: 'DESCARTADA', nome: 'Descartada', cor: '#ef4444' }
];
const SLUGS = ETAPAS.map((e) => e.slug);

export const porId = (id) => get('SELECT * FROM demos WHERE id = ?', id);
export const doLead = (leadId) => all('SELECT * FROM demos WHERE lead_id = ? ORDER BY id DESC', leadId);

export function listar({ status = null, limite = 200 } = {}) {
  return all(
    `SELECT d.*, l.nome_estabelecimento, l.cidade, l.categoria, l.nicho, l.etiqueta, l.score, l.telefone_e164, l.google_maps
       FROM demos d JOIN leads l ON l.id = d.lead_id
      ${status ? 'WHERE d.status = ?' : ''}
      ORDER BY d.updated_at DESC, d.id DESC LIMIT ?`,
    ...(status ? [status] : []),
    limite
  );
}

/**
 * Cria a demo ja com os dados do lead (spec 59.13: os campos chegam preenchidos).
 * Nao existe um segundo cadastro de estabelecimento: a demo aponta para o lead.
 */
export function criar({ leadId, url = null, titulo = null, observacoes = null }) {
  const lead = leadRepo.porId(leadId);
  if (!lead) throw new AppError('Lead nao encontrado.', 404);

  const r = run(
    'INSERT INTO demos (lead_id, titulo, url, observacoes) VALUES (?,?,?,?)',
    leadId,
    titulo || `Modelo para ${lead.nome_estabelecimento}`,
    url,
    observacoes
  );
  const demo = porId(Number(r.lastInsertRowid));

  leadRepo.atualizar(leadId, { pipeline: 'DEMO' });
  ActivityService.registrar({
    lead_id: leadId,
    tipo: 'DEMO_CRIADA',
    descricao: url || 'Sem link ainda',
    meta: { demo_id: demo.id }
  });
  ScoreService.recalcular(leadId);
  bus.emit(EVENTOS.DEMO, demo);
  return { demo, lead: leadRepo.porId(leadId) };
}

export function atualizar(id, patch = {}) {
  const demo = porId(id);
  if (!demo) throw new AppError('Demonstracao nao encontrada.', 404);
  const permitido = ['titulo', 'url', 'status', 'feedback', 'observacoes'];
  const entradas = Object.entries(patch).filter(([k]) => permitido.includes(k));
  if (entradas.length) {
    run(
      `UPDATE demos SET ${entradas.map(([k]) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
      ...entradas.map(([, v]) => v),
      id
    );
  }
  const atualizado = porId(id);
  bus.emit(EVENTOS.DEMO, atualizado);
  return atualizado;
}

export function marcarEnviada(id) {
  const demo = porId(id);
  if (!demo) throw new AppError('Demonstracao nao encontrada.', 404);
  run("UPDATE demos SET status = 'ENVIADA', enviada_em = COALESCE(enviada_em, datetime('now')), updated_at = datetime('now') WHERE id = ?", id);
  ActivityService.registrar({ lead_id: demo.lead_id, tipo: 'DEMO_ENVIADA', descricao: demo.url || null, meta: { demo_id: id } });
  ScoreService.recalcular(demo.lead_id);
  const atualizado = porId(id);
  bus.emit(EVENTOS.DEMO, atualizado);
  return atualizado;
}

/** Registro manual de acesso (o operador viu que o cliente abriu). */
export function registrarAcesso(id) {
  const demo = porId(id);
  if (!demo) throw new AppError('Demonstracao nao encontrada.', 404);
  run(
    `UPDATE demos SET
       acessos = acessos + 1,
       status = CASE WHEN status IN ('CRIADA','ENVIADA') THEN 'ACESSADA' ELSE status END,
       primeiro_acesso = COALESCE(primeiro_acesso, datetime('now')),
       ultimo_acesso = datetime('now'),
       updated_at = datetime('now')
     WHERE id = ?`,
    id
  );
  ActivityService.registrar({ lead_id: demo.lead_id, tipo: 'DEMO_ACESSADA', meta: { demo_id: id } });
  ActivityService.notificar({
    tipo: 'demo',
    titulo: 'Demonstracao acessada',
    texto: 'O cliente abriu o modelo que voce enviou.',
    lead_id: demo.lead_id,
    rota: `/conversas?lead=${demo.lead_id}`
  });
  ScoreService.recalcular(demo.lead_id);
  const atualizado = porId(id);
  bus.emit(EVENTOS.DEMO, atualizado);
  return atualizado;
}

export function registrarFeedback(id, texto) {
  const demo = porId(id);
  if (!demo) throw new AppError('Demonstracao nao encontrada.', 404);
  run("UPDATE demos SET feedback = ?, status = 'FEEDBACK', updated_at = datetime('now') WHERE id = ?", texto, id);
  ActivityService.registrar({ lead_id: demo.lead_id, tipo: 'DEMO_FEEDBACK', descricao: String(texto).slice(0, 200), meta: { demo_id: id } });
  ScoreService.recalcular(demo.lead_id);
  return porId(id);
}

export function mudarStatus(id, status) {
  if (!SLUGS.includes(status)) throw new AppError('Status de demonstracao invalido.');
  const demo = atualizar(id, { status });
  if (status === 'NEGOCIACAO') leadRepo.atualizar(demo.lead_id, { pipeline: 'NEGOCIACAO' });
  ScoreService.recalcular(demo.lead_id);
  return demo;
}

export function excluir(id) {
  const demo = porId(id);
  if (!demo) throw new AppError('Demonstracao nao encontrada.', 404);
  run('DELETE FROM demos WHERE id = ?', id);
  return { ok: true };
}

export function estatisticas() {
  const linha = get(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'CRIADA' THEN 1 ELSE 0 END) AS criadas,
      SUM(CASE WHEN enviada_em IS NOT NULL THEN 1 ELSE 0 END) AS enviadas,
      SUM(CASE WHEN acessos > 0 THEN 1 ELSE 0 END) AS acessadas,
      SUM(CASE WHEN feedback IS NOT NULL AND TRIM(feedback) <> '' THEN 1 ELSE 0 END) AS com_feedback,
      SUM(CASE WHEN status = 'FECHADA' THEN 1 ELSE 0 END) AS fechadas
    FROM demos`);
  const n = (v) => Number(v || 0);
  return {
    total: n(linha?.total),
    criadas: n(linha?.criadas),
    enviadas: n(linha?.enviadas),
    acessadas: n(linha?.acessadas),
    com_feedback: n(linha?.com_feedback),
    fechadas: n(linha?.fechadas),
    taxa_acesso: n(linha?.enviadas) ? Number(((n(linha?.acessadas) / n(linha?.enviadas)) * 100).toFixed(1)) : 0
  };
}

export default {
  criar, atualizar, marcarEnviada, registrarAcesso, registrarFeedback, mudarStatus,
  excluir, listar, doLead, porId, estatisticas, ETAPAS
};
