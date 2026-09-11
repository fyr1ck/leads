import whatsapp from './whatsapp/WhatsAppService.js';
import AIService from './ai/AIService.js';
import * as leadRepo from '../repositories/leadRepo.js';
import * as messageRepo from '../repositories/messageRepo.js';
import * as historyRepo from '../repositories/historyRepo.js';
import * as analysisRepo from '../repositories/analysisRepo.js';
import * as tagRepo from '../repositories/tagRepo.js';
import * as settingsRepo from '../repositories/settingsRepo.js';
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
  const e164 = normalizarTelefone(msg.telefone);
  if (!e164) return null;

  const existente = leadRepo.porTelefone(e164);
  if (existente) return existente;

  // Numero desconhecido respondeu: cria um lead com os dados REAIS que temos
  // (nome do perfil do WhatsApp e telefone). Nada inventado (spec 52).
  const { lead } = leadRepo.criarOuEnriquecer(
    {
      nome_estabelecimento: msg.pushName?.trim() || formatarTelefone(e164),
      telefone: e164,
      observacoes: 'Lead criado automaticamente a partir de uma mensagem recebida.'
    },
    'WHATSAPP_INBOUND'
  );
  logger.info('inbox', `Nova conversa de um numero que nao estava na base: ${lead.nome_estabelecimento}`);
  return lead;
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

    logger.info('inbox', `${atualizado.nome_estabelecimento} respondeu.`);
    bus.emit(EVENTOS.MENSAGEM_RECEBIDA, { lead: atualizado, mensagem: registrada });
    bus.emit(EVENTOS.LEAD_ATUALIZADO, { lead: atualizado });

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

    try {
      tagRepo.vincular(lead.id, analise.etiqueta, 'IA');
    } catch {
      /* etiqueta personalizada removida: segue sem vincular */
    }

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
  logger.info('inbox', 'Monitor de respostas ativo (analise sim, resposta automatica nao).');
}

export default { iniciarInbound };
