import { all, get, run } from '../db/index.js';
import * as leadRepo from '../repositories/leadRepo.js';
import * as messageRepo from '../repositories/messageRepo.js';
import * as settingsRepo from '../repositories/settingsRepo.js';
import AIService from './ai/AIService.js';
import MessageService from './MessageService.js';
import ActivityService from './ActivityService.js';
import { bus, EVENTOS } from '../realtime/bus.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

/**
 * Follow-up (spec 66).
 *
 * Fluxo obrigatorio: IA prepara -> operador revisa -> operador confirma -> envia.
 * O status AGUARDANDO_CONFIRMACAO existe justamente para nada sair sozinho.
 */
const STATUS = ['PENDENTE', 'PREPARADO', 'AGUARDANDO_CONFIRMACAO', 'ENVIADO', 'CANCELADO'];

const prazosConfigurados = () => {
  const bruto = settingsRepo.obter('followup_dias') || '1,3,7';
  return String(bruto)
    .split(',')
    .map((n) => Number(String(n).trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
};

export const porId = (id) => get('SELECT * FROM follow_ups WHERE id = ?', id);

export function agendar(leadId, { prazoDias = 1, origem = 'OPERADOR', motivo = null, campaignId = null } = {}) {
  const lead = leadRepo.porId(leadId);
  if (!lead) throw new AppError('Lead nao encontrado.', 404);

  const jaExiste = get(
    "SELECT * FROM follow_ups WHERE lead_id = ? AND prazo_dias = ? AND status IN ('PENDENTE','PREPARADO','AGUARDANDO_CONFIRMACAO')",
    leadId,
    prazoDias
  );
  if (jaExiste) return jaExiste;

  const r = run(
    `INSERT INTO follow_ups (lead_id, campaign_id, prazo_dias, agendado_para, origem, motivo)
     VALUES (?,?,?, datetime('now', '+' || ? || ' days'), ?, ?)`,
    leadId,
    campaignId,
    prazoDias,
    prazoDias,
    origem,
    motivo
  );
  const fu = porId(Number(r.lastInsertRowid));

  leadRepo.atualizar(leadId, { proximo_followup: fu.agendado_para });
  ActivityService.registrar({
    lead_id: leadId,
    tipo: 'FOLLOWUP_CRIADO',
    descricao: `Follow-up de +${prazoDias} dia(s)${motivo ? ` · ${motivo}` : ''}`,
    meta: { follow_up_id: fu.id }
  });
  bus.emit(EVENTOS.FOLLOWUP, fu);
  return fu;
}

/** Agenda a sequencia padrao (+1, +3, +7) depois do primeiro contato. */
export function agendarSequencia(leadId, { campaignId = null } = {}) {
  return prazosConfigurados().map((dias) =>
    agendar(leadId, { prazoDias: dias, origem: 'AUTOMATICO', motivo: 'Sequencia automatica apos o contato', campaignId })
  );
}

/** Follow-ups que já venceram e continuam esperando ação. */
export const vencidos = () =>
  all(
    `SELECT f.*, l.nome_estabelecimento, l.cidade, l.etiqueta, l.score, l.telefone_e164, l.ultima_mensagem
       FROM follow_ups f JOIN leads l ON l.id = f.lead_id
      WHERE f.status IN ('PENDENTE','PREPARADO','AGUARDANDO_CONFIRMACAO')
        AND datetime(f.agendado_para) <= datetime('now')
      ORDER BY f.agendado_para ASC`
  );

export const listar = ({ status = null, limite = 200 } = {}) =>
  all(
    `SELECT f.*, l.nome_estabelecimento, l.cidade, l.etiqueta, l.score, l.respondeu, l.telefone_e164
       FROM follow_ups f JOIN leads l ON l.id = f.lead_id
      ${status ? 'WHERE f.status = ?' : ''}
      ORDER BY f.agendado_para ASC LIMIT ?`,
    ...(status ? [status] : []),
    limite
  );

/** A IA escreve a proposta de follow-up; ninguem envia nada ainda (spec 66). */
export async function prepararComIA(id) {
  const fu = porId(id);
  if (!fu) throw new AppError('Follow-up nao encontrado.', 404);
  const lead = leadRepo.porId(fu.lead_id);
  if (!lead) throw new AppError('Lead nao encontrado.', 404);

  const historico = messageRepo.doLead(lead.id, 20);
  const r = await AIService.gerarFollowUp({ lead, historico, diasSemResposta: fu.prazo_dias });

  run(
    "UPDATE follow_ups SET mensagem = ?, status = 'AGUARDANDO_CONFIRMACAO', updated_at = datetime('now') WHERE id = ?",
    r.mensagem,
    id
  );
  const atualizado = porId(id);
  bus.emit(EVENTOS.FOLLOWUP, atualizado);
  return { ...atualizado, origem_mensagem: r.origem };
}

/**
 * Envio do follow-up. So acontece por acao explicita do operador:
 * esta funcao e chamada apenas pela rota de confirmacao (spec 66 / regra de ouro).
 */
export async function confirmarEnvio(id, { texto = null } = {}) {
  const fu = porId(id);
  if (!fu) throw new AppError('Follow-up nao encontrado.', 404);
  if (fu.status === 'ENVIADO') throw new AppError('Esse follow-up ja foi enviado.');

  const lead = leadRepo.porId(fu.lead_id);
  const mensagem = String(texto || fu.mensagem || '').trim();
  if (!mensagem) throw new AppError('Prepare a mensagem antes de enviar.');

  await MessageService.enviar({ lead, texto: mensagem, autor: 'OPERADOR' });

  run("UPDATE follow_ups SET status = 'ENVIADO', mensagem = ?, enviado_em = datetime('now'), updated_at = datetime('now') WHERE id = ?", mensagem, id);
  ActivityService.registrar({
    lead_id: lead.id,
    tipo: 'FOLLOWUP_ENVIADO',
    descricao: mensagem.slice(0, 160),
    meta: { follow_up_id: id }
  });
  logger.ok('followup', `Follow-up enviado para ${lead.nome_estabelecimento}.`);
  const atualizado = porId(id);
  bus.emit(EVENTOS.FOLLOWUP, atualizado);
  return atualizado;
}

export function cancelar(id, motivo = null) {
  const fu = porId(id);
  if (!fu) throw new AppError('Follow-up nao encontrado.', 404);
  run("UPDATE follow_ups SET status = 'CANCELADO', cancelado_em = datetime('now'), motivo = COALESCE(?, motivo), updated_at = datetime('now') WHERE id = ?", motivo, id);
  ActivityService.registrar({ lead_id: fu.lead_id, tipo: 'FOLLOWUP_CANCELADO', descricao: motivo || 'Cancelado pelo operador.' });
  const atualizado = porId(id);
  bus.emit(EVENTOS.FOLLOWUP, atualizado);
  return atualizado;
}

/** Quando o cliente responde, os follow-ups pendentes perdem o sentido. */
export function cancelarPendentesDoLead(leadId, motivo = 'O cliente respondeu.') {
  const abertos = all(
    "SELECT id FROM follow_ups WHERE lead_id = ? AND status IN ('PENDENTE','PREPARADO','AGUARDANDO_CONFIRMACAO')",
    leadId
  );
  for (const f of abertos) cancelar(f.id, motivo);
  if (abertos.length) leadRepo.atualizar(leadId, { proximo_followup: null });
  return abertos.length;
}

/**
 * PROXIMAS ACOES do dashboard (spec 67).
 * Junta quem respondeu e ainda nao foi atendido, follow-ups vencidos e
 * oportunidades quentes paradas.
 */
export function proximasAcoes(limite = 10) {
  const acoes = [];

  const naoRespondidos = all(
    `SELECT l.*, (SELECT MAX(m.created_at) FROM messages m WHERE m.lead_id = l.id AND m.direcao = 'IN') AS ultima_entrada
       FROM leads l
      WHERE l.respondeu = 1
        AND EXISTS (SELECT 1 FROM messages m WHERE m.lead_id = l.id AND m.direcao = 'IN' AND m.lida = 0)
      ORDER BY l.score DESC, ultima_entrada DESC
      LIMIT ?`,
    limite
  );
  for (const l of naoRespondidos) {
    acoes.push({
      tipo: 'RESPONDER',
      urgencia: l.score >= 70 ? 'ALTA' : 'MEDIA',
      lead_id: l.id,
      nome: l.nome_estabelecimento,
      cidade: l.cidade,
      score: l.score,
      etiqueta: l.etiqueta,
      texto: l.ultima_mensagem,
      quando: l.ultima_entrada || l.ultima_mensagem_data,
      acao: 'Responder'
    });
  }

  for (const f of vencidos().slice(0, limite)) {
    acoes.push({
      tipo: 'FOLLOWUP',
      urgencia: 'MEDIA',
      lead_id: f.lead_id,
      follow_up_id: f.id,
      nome: f.nome_estabelecimento,
      cidade: f.cidade,
      score: f.score,
      etiqueta: f.etiqueta,
      texto: f.motivo || `Follow-up de +${f.prazo_dias} dia(s) venceu`,
      quando: f.agendado_para,
      acao: 'Preparar follow-up'
    });
  }

  const paradas = all(
    `SELECT l.* FROM leads l
      WHERE l.score >= 70 AND l.status <> 'FECHADO'
        AND (l.ultima_mensagem_data IS NULL OR datetime(l.ultima_mensagem_data) <= datetime('now', '-2 days'))
        AND l.respondeu = 1
      ORDER BY l.score DESC LIMIT ?`,
    limite
  );
  for (const l of paradas) {
    if (acoes.some((a) => a.lead_id === l.id)) continue;
    acoes.push({
      tipo: 'RETOMAR',
      urgencia: 'ALTA',
      lead_id: l.id,
      nome: l.nome_estabelecimento,
      cidade: l.cidade,
      score: l.score,
      etiqueta: l.etiqueta,
      texto: l.ultima_mensagem,
      quando: l.ultima_mensagem_data,
      acao: 'Retomar conversa'
    });
  }

  const ordem = { ALTA: 2, MEDIA: 1, BAIXA: 0 };
  return acoes
    .sort((a, b) => (ordem[b.urgencia] - ordem[a.urgencia]) || (b.score || 0) - (a.score || 0))
    .slice(0, limite);
}

export default {
  agendar, agendarSequencia, listar, vencidos, prepararComIA, confirmarEnvio,
  cancelar, cancelarPendentesDoLead, proximasAcoes, porId, STATUS
};
