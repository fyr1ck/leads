import whatsapp from './whatsapp/WhatsAppService.js';
import AIService from './ai/AIService.js';
import * as leadRepo from '../repositories/leadRepo.js';
import * as messageRepo from '../repositories/messageRepo.js';
import * as historyRepo from '../repositories/historyRepo.js';
import * as analysisRepo from '../repositories/analysisRepo.js';
import * as tagRepo from '../repositories/tagRepo.js';
import * as settingsRepo from '../repositories/settingsRepo.js';
import ActivityService from './ActivityService.js';
import ScoreService from './ScoreService.js';
import FollowUpService from './FollowUpService.js';
import LabelService from './whatsapp/LabelService.js';
import { bus, EVENTOS } from '../realtime/bus.js';
import { logger } from '../utils/logger.js';
import { normalizarTelefone, formatarTelefone } from '../utils/phone.js';
import { faixaPotencial, grupoOportunidade } from '../domain/classificacao.js';

/**
 * Fluxo da resposta recebida (spec 50):
 *
 *   CLIENTE RESPONDE -> SISTEMA DETECTA -> GROQ ANALISA -> ETIQUETA
 *   -> SUGESTAO DE RESPOSTA -> OPERADOR VISUALIZA -> OPERADOR DECIDE SE ENVIA
 *
 * Este arquivo NAO importa o MessageService de proposito: nao existe caminho
 * possivel daqui para um envio automatico.
 */
function garantirLead(msg) {
  // msg.telefone pode ser null: conversa que chegou so com LID (xxx@lid).
  const e164 = msg.telefone ? normalizarTelefone(msg.telefone) : null;
  if (!e164 && !msg.jid) return null;

  // 1) pelo endereco exato da conversa  2) pelo numero real
  const existente = leadRepo.porWaJid(msg.jid) || (e164 && leadRepo.porTelefone(e164)) || null;

  if (existente) {
    const patch = {};
    // o ultimo endereco de onde a pessoa escreveu e o destino mais confiavel
    if (msg.jid && existente.wa_jid !== msg.jid) patch.wa_jid = msg.jid;
    if (e164 && !existente.telefone_e164 && !leadRepo.porTelefone(e164)) {
      patch.telefone_e164 = e164;
      patch.telefone = e164;
    }
    return Object.keys(patch).length ? leadRepo.atualizar(existente.id, patch) : existente;
  }

  // Contato novo respondeu: cria o lead so com dados REAIS (spec 52) - nome do
  // perfil do WhatsApp e, quando existir, o telefone. Nunca os digitos do LID.
  const lead = leadRepo.criarDeWhatsApp({
    nome: msg.pushName?.trim() || (e164 ? formatarTelefone(e164) : 'Contato do WhatsApp'),
    telefone_e164: e164,
    wa_jid: msg.jid || null
  });
  logger.info(
    'inbox',
    `Nova conversa de fora da base: ${lead.nome_estabelecimento}${e164 ? '' : ' (numero oculto pelo WhatsApp)'}`
  );
  return lead;
}

/**
 * O WhatsApp revelou o numero por tras de um LID. Se esse numero ja era de um
 * lead (tipico: prospectamos pelo telefone e a resposta veio por LID), junta os
 * dois para a conversa ficar num lugar so.
 */
export function vincularNumero({ lid, telefone }) {
  try {
    const e164 = normalizarTelefone(telefone);
    if (!lid || !e164) return;
    const doLid = leadRepo.porWaJid(lid);
    const doTelefone = leadRepo.porTelefone(e164);

    if (doLid && doTelefone && doLid.id !== doTelefone.id) {
      const unido = leadRepo.mesclar(doTelefone.id, doLid.id);
      ScoreService.recalcular(unido.id, { silencioso: true });
      logger.ok('inbox', `Conversa por LID unida ao lead ${unido.nome_estabelecimento}.`);
      bus.emit(EVENTOS.LEAD_ATUALIZADO, { lead: unido });
    } else if (doLid && !doTelefone && !doLid.telefone_e164) {
      bus.emit(EVENTOS.LEAD_ATUALIZADO, { lead: leadRepo.atualizar(doLid.id, { telefone_e164: e164, telefone: e164 }) });
    } else if (!doLid && doTelefone && !doTelefone.wa_jid) {
      leadRepo.atualizar(doTelefone.id, { wa_jid: lid });
    }
  } catch (err) {
    logger.warn('inbox', `Nao consegui vincular numero ao LID: ${err.message}`);
  }
}

/**
 * Conserta leads criados antes desta correcao, quando os digitos do LID eram
 * gravados como telefone. Um lead que chegou pelo WhatsApp mas cujo "numero"
 * nao existe no WhatsApp so pode ser um LID. Roda uma vez por conexao.
 */
export async function repararContatosLid() {
  const suspeitos = leadRepo.suspeitosDeLid();
  let corrigidos = 0;
  for (const lead of suspeitos) {
    try {
      const jid = await whatsapp.consultarNumero(lead.telefone_e164);
      if (jid) {
        leadRepo.atualizar(lead.id, { wa_jid: jid }); // era telefone de verdade
      } else {
        leadRepo.converterParaLid(lead);
        corrigidos += 1;
      }
    } catch {
      /* consulta falhou: tenta de novo na proxima conexao */
    }
  }
  if (corrigidos) {
    logger.ok('inbox', `${corrigidos} contato(s) com LID gravado como telefone foram corrigidos.`);
    bus.emit(EVENTOS.STATS, {});
  }
}

async function processar(msg) {
  try {
    if (msg.waId && messageRepo.jaExisteWaId(msg.waId)) return; // re-sync do WhatsApp

    const lead = garantirLead(msg);
    if (!lead) {
      logger.warn('inbox', `Mensagem recebida de um numero invalido (${msg.telefone}). Ignorada.`);
      return;
    }

    const registrada = messageRepo.registrar({
      lead_id: lead.id,
      direcao: 'IN',
      corpo: msg.texto,
      telefone: lead.telefone_e164,
      wa_message_id: msg.waId,
      status: 'RECEBIDA',
      autor: 'CLIENTE',
      lida: 0
    });

    let atualizado = leadRepo.marcarResposta(lead.id, msg.texto);

    historyRepo.registrar({
      lead: atualizado,
      tipo: 'RESPOSTA',
      mensagem: null,
      status: 'RECEBIDA',
      resposta: msg.texto
    });

    ActivityService.registrar({
      lead_id: lead.id,
      tipo: 'MENSAGEM_RECEBIDA',
      descricao: msg.texto.slice(0, 180),
      meta: { message_id: registrada.id }
    });
    // Quem respondeu nao precisa mais da cobranca automatica (spec 66).
    FollowUpService.cancelarPendentesDoLead(lead.id);

    logger.info('inbox', `${atualizado.nome_estabelecimento} respondeu.`);
    bus.emit(EVENTOS.MENSAGEM_RECEBIDA, { lead: atualizado, mensagem: registrada });
    bus.emit(EVENTOS.LEAD_ATUALIZADO, { lead: atualizado });

    const etiquetaAnterior = atualizado.etiqueta;
    const cfg = settingsRepo.obterTodas();
    if (!cfg.ia_analise_automatica) {
      bus.emit(EVENTOS.STATS, {});
      return;
    }

    // ---- ANALISE (a IA so analisa; jamais responde) ----
    const historico = messageRepo.doLead(lead.id, 20);
    const analise = await AIService.analisarResposta({ lead: atualizado, mensagem: msg.texto, historico });

    const salva = analysisRepo.registrar({
      lead_id: lead.id,
      message_id: registrada.id,
      etiqueta: analise.etiqueta,
      prioridade: analise.prioridade,
      confianca: analise.confianca,
      score: analise.score,
      motivo: analise.motivo,
      sugestao_resposta: analise.sugestao_resposta,
      proxima_etapa: analise.proxima_etapa,
      modelo: analise.modelo || analise.origem,
      bruto: analise.bruto || null
    });

    atualizado = leadRepo.aplicarAnalise(lead.id, {
      etiqueta: analise.etiqueta,
      prioridade: analise.prioridade,
      score: analise.score,
      pipeline: analise.proxima_etapa
    });

    // O score final vem de sinais reais e auditaveis (spec 61); a leitura da IA
    // entra como um dos sinais, nao como a palavra final.
    const pontuacao = ScoreService.recalcular(lead.id);
    atualizado = leadRepo.porId(lead.id);

    ActivityService.registrar({
      lead_id: lead.id,
      tipo: 'ETIQUETA',
      titulo: `Etiqueta: ${analise.etiqueta.replace(/_/g, ' ').toLowerCase()}`,
      descricao: analise.motivo,
      meta: { confianca: analise.confianca, origem: analise.origem }
    });

    try {
      tagRepo.vincular(lead.id, analise.etiqueta, 'IA');
    } catch {
      /* etiqueta personalizada removida: segue sem vincular */
    }

    // Espelha a etiqueta na conversa do WhatsApp (WhatsApp Business).
    // Falha aqui nao pode atrapalhar a analise, entao e sempre best-effort.
    LabelService.aplicarNoLead(atualizado, analise.etiqueta, etiquetaAnterior).catch(() => {});

    historyRepo.registrar({
      lead: atualizado,
      tipo: 'ETIQUETA',
      status: analise.etiqueta,
      resposta: analise.motivo,
      etiqueta: analise.etiqueta
    });

    logger.ok(
      'ia',
      `IA classificou ${atualizado.nome_estabelecimento} como ${analise.etiqueta} (${Math.round(
        analise.confianca * 100
      )}% de confianca).`
    );

    const payload = {
      lead: atualizado,
      mensagem: registrada,
      analise: {
        ...analise,
        id: salva.id,
        potencial: faixaPotencial(analise.score),
        grupo: grupoOportunidade(analise.etiqueta)
      },
      // Deixa explicito para o painel: a sugestao NAO foi enviada.
      enviadoAutomaticamente: false
    };
    bus.emit(EVENTOS.ANALISE_PRONTA, payload);
    bus.emit(EVENTOS.LEAD_ATUALIZADO, { lead: atualizado });
    bus.emit(EVENTOS.ALERTA, {
      tipo: 'resposta',
      titulo: `${atualizado.nome_estabelecimento} respondeu`,
      texto: analise.etiqueta.replace(/_/g, ' '),
      leadId: atualizado.id
    });

    // Notificacao persistente (spec 75): fica na central ate ser lida.
    const quente = (pontuacao?.score ?? atualizado.score) >= 70;
    ActivityService.notificar({
      tipo: quente ? 'lead_quente' : 'resposta',
      titulo: `${quente ? '\u{1F525} ' : ''}${atualizado.nome_estabelecimento} respondeu`,
      texto: `${analise.etiqueta.replace(/_/g, ' ').toLowerCase()} · score ${pontuacao?.score ?? atualizado.score}`,
      lead_id: atualizado.id,
      rota: `/conversas?lead=${atualizado.id}`
    });
    bus.emit(EVENTOS.STATS, {});
  } catch (err) {
    logger.erro('inbox', `Erro ao processar mensagem recebida: ${err.message}`);
  }
}

let ligado = false;

export function iniciarInbound() {
  if (ligado) return;
  ligado = true;
  whatsapp.on('mensagem', (msg) => {
    // fila implicita: cada mensagem e processada de forma independente
    processar(msg);
  });
  whatsapp.on('numeroCompartilhado', vincularNumero);

  let reparado = false;
  whatsapp.on('status', ({ conectado }) => {
    if (!conectado || reparado) return;
    reparado = true;
    // espera a sessao assentar antes de consultar numeros
    setTimeout(() => repararContatosLid().catch(() => {}), 5000);
  });
  logger.info('inbox', 'Monitor de respostas ativo (analise sim, resposta automatica nao).');
}

export default { iniciarInbound, vincularNumero, repararContatosLid };
