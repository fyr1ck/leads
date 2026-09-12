import { all, get } from '../db/index.js';
import * as leadRepo from '../repositories/leadRepo.js';
import ActivityService from './ActivityService.js';
import { faixaPotencial } from '../domain/classificacao.js';
import { bus, EVENTOS } from '../realtime/bus.js';

/**
 * Score do lead, de 0 a 100 (spec 61).
 *
 * Nao e um numero magico: cada ponto vem de um sinal real registrado no banco,
 * e a lista de motivos fica visivel no painel. Isso permite o vendedor discordar
 * com base em fato, e nao em "a IA disse".
 */
const BASE = 10;

const DIAS = (iso) => {
  if (!iso) return null;
  const t = new Date(String(iso).includes('T') ? iso : `${String(iso).replace(' ', 'T')}Z`).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
};

/** Peso de cada etiqueta na pontuacao. */
const PESO_ETIQUETA = {
  QUER_CONTRATAR: { pontos: 45, texto: 'Demonstrou intencao de contratar' },
  NEGOCIANDO: { pontos: 40, texto: 'Esta negociando' },
  QUER_SABER_PRECO: { pontos: 35, texto: 'Perguntou o preco' },
  PEDIU_DEMONSTRACAO: { pontos: 35, texto: 'Pediu a demonstracao' },
  INTERESSADO: { pontos: 30, texto: 'Demonstrou interesse' },
  PEDIU_INFORMACOES: { pontos: 22, texto: 'Pediu mais informacoes' },
  QUER_CONTATO: { pontos: 18, texto: 'Pediu contato' },
  FALAR_DEPOIS: { pontos: 12, texto: 'Pediu para falar depois' },
  RESPONDEU: { pontos: 10, texto: 'Respondeu a abordagem' },
  AGUARDANDO_RESPOSTA: { pontos: 4, texto: 'Conversa em aberto' },
  REVISAR_MANUALMENTE: { pontos: 2, texto: 'Resposta ambigua, precisa de leitura humana' },
  JA_POSSUI_SITE: { pontos: -8, texto: 'Ja possui site' },
  NAO_INTERESSADO: { pontos: -45, texto: 'Disse que nao tem interesse' },
  RECUSOU: { pontos: -50, texto: 'Recusou a proposta' },
  SEM_RESPOSTA: { pontos: -8, texto: 'Nao respondeu' }
};

/** Calcula o score e a lista de motivos, sem gravar nada. */
export function calcular(leadId) {
  const lead = leadRepo.porId(leadId);
  if (!lead) return null;

  const motivos = [];
  let score = BASE;
  const soma = (pontos, texto) => {
    if (!pontos) return;
    score += pontos;
    motivos.push({ pontos, texto });
  };

  const msgs = all(
    "SELECT direcao, created_at FROM messages WHERE lead_id = ? ORDER BY created_at ASC",
    leadId
  );
  const recebidas = msgs.filter((m) => m.direcao === 'IN');
  const enviadas = msgs.filter((m) => m.direcao === 'OUT');
  const demo = get('SELECT * FROM demos WHERE lead_id = ? ORDER BY id DESC LIMIT 1', leadId);
  const venda = get('SELECT * FROM sales WHERE lead_id = ? ORDER BY id DESC LIMIT 1', leadId);
  const analise = get('SELECT * FROM ai_analyses WHERE lead_id = ? ORDER BY id DESC LIMIT 1', leadId);

  // ---------------- sinais positivos ----------------
  if (recebidas.length) soma(15, 'Respondeu o contato');
  if (recebidas.length > 1) soma(Math.min(10, (recebidas.length - 1) * 4), `Manteve a conversa (${recebidas.length} mensagens)`);

  const peso = PESO_ETIQUETA[lead.etiqueta];
  if (peso) soma(peso.pontos, peso.texto);

  if (!lead.site || String(lead.site).trim() === '') soma(5, 'Site proprio nao identificado');

  if (demo) {
    if (demo.status === 'ENVIADA' || demo.acessos > 0) soma(8, 'Demonstracao enviada');
    if (demo.acessos > 0) soma(15, `Acessou a demonstracao (${demo.acessos}x)`);
    if (demo.feedback) soma(10, 'Deu feedback sobre a demonstracao');
    const diasEnvio = DIAS(demo.enviada_em);
    if (demo.enviada_em && !demo.acessos && diasEnvio !== null && diasEnvio >= 3) {
      soma(-10, `Demonstracao enviada ha ${diasEnvio} dias e ainda nao foi acessada`);
    }
  }

  if (venda) soma(25, 'Venda registrada');

  // A leitura da IA entra como ajuste fino, com peso limitado.
  if (analise?.score != null) {
    const ajuste = Math.round((Number(analise.score) - 50) / 10);
    if (ajuste) soma(Math.max(-8, Math.min(8, ajuste)), `Leitura da IA sobre a conversa (${analise.score}/100)`);
  }

  // ---------------- sinais negativos ----------------
  if (enviadas.length && !recebidas.length) soma(-10, 'Foi contatado e ainda nao respondeu');

  const diasSemInteracao = DIAS(lead.ultima_mensagem_data || lead.data_ultimo_contato);
  if (diasSemInteracao !== null && recebidas.length) {
    if (diasSemInteracao >= 14) soma(-15, `Sem interacao ha ${diasSemInteracao} dias`);
    else if (diasSemInteracao >= 7) soma(-10, `Sem interacao ha ${diasSemInteracao} dias`);
    else if (diasSemInteracao >= 3) soma(-5, `Sem interacao ha ${diasSemInteracao} dias`);
  }

  if (!lead.telefone_e164) soma(-10, 'Sem telefone valido para contato');

  const final = Math.max(0, Math.min(100, Math.round(score)));
  const faixa = faixaPotencial(final);

  return {
    score: final,
    temperatura: faixa.faixa,
    faixa,
    motivos: motivos.sort((a, b) => Math.abs(b.pontos) - Math.abs(a.pontos))
  };
}

/** Recalcula e grava no lead. Registra na timeline quando muda de verdade. */
export function recalcular(leadId, { silencioso = false } = {}) {
  const lead = leadRepo.porId(leadId);
  if (!lead) return null;
  const r = calcular(leadId);
  if (!r) return null;

  const mudou = Number(lead.score || 0) !== r.score;
  leadRepo.atualizar(leadId, {
    score: r.score,
    temperatura: r.temperatura,
    score_motivos: JSON.stringify(r.motivos)
  });

  if (mudou && !silencioso) {
    ActivityService.registrar({
      lead_id: leadId,
      tipo: 'SCORE',
      titulo: `Score alterado para ${r.score}`,
      descricao: r.motivos.slice(0, 3).map((m) => `${m.pontos > 0 ? '+' : ''}${m.pontos} ${m.texto}`).join(' · '),
      meta: { de: lead.score, para: r.score, temperatura: r.temperatura }
    });
    bus.emit(EVENTOS.LEAD_ATUALIZADO, { lead: leadRepo.porId(leadId) });
  }

  return r;
}

/** Recalcula a base inteira (usado depois de importacoes grandes). */
export function recalcularTodos({ apenasComInteracao = true } = {}) {
  const ids = all(
    `SELECT id FROM leads ${apenasComInteracao ? 'WHERE respondeu = 1 OR quantidade_mensagens_enviadas > 0' : ''}`
  ).map((l) => l.id);
  for (const id of ids) recalcular(id, { silencioso: true });
  return ids.length;
}

export default { calcular, recalcular, recalcularTodos };
