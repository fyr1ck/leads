import whatsapp from './whatsapp/WhatsAppService.js';
import * as leadRepo from '../repositories/leadRepo.js';
import * as messageRepo from '../repositories/messageRepo.js';
import * as historyRepo from '../repositories/historyRepo.js';
import * as settingsRepo from '../repositories/settingsRepo.js';
import ActivityService from './ActivityService.js';
import { bus, EVENTOS } from '../realtime/bus.js';
import { logger } from '../utils/logger.js';
import { AppError, mensagemAmigavel } from '../utils/errors.js';

/**
 * UNICO ponto do sistema que envia mensagem no WhatsApp.
 *
 * Quem chama: CampaignRunner (prospeccao) e a rota de envio manual do operador.
 * Quem NAO chama: o InboundHandler. Resposta de cliente nunca dispara envio -
 * essa e a regra de ouro do projeto (spec 15 / 28 / 50).
 */
export const MessageService = {
  async enviar({ lead, texto, campanha = null, autor = 'OPERADOR', removerDaProspeccao }) {
    if (!lead) throw new AppError('Lead invalido.', 400);
    // Conversa ja existente: responde no endereco exato de onde ela veio
    // (inclusive LID). Lead novo: vai pelo telefone, conferido no WhatsApp.
    const destino = lead.wa_jid || lead.telefone_e164;
    if (!destino) throw new AppError('Esse lead nao tem telefone nem conversa de WhatsApp para responder.', 400);
    const corpo = String(texto || '').trim();
    if (!corpo) throw new AppError('A mensagem esta vazia.', 400);

    if (!whatsapp.conectado) {
      throw new AppError('Nao foi possivel enviar a mensagem. O WhatsApp pode estar desconectado.', 409);
    }

    const cfg = settingsRepo.obterTodas();
    // O limite e da prospeccao: responder quem ja falou com voce nao conta.
    if (campanha) {
      const limite = settingsRepo.limiteDiarioEfetivo(cfg);
      if (limite > 0 && messageRepo.enviadasHoje({ soCampanha: true }) >= limite) {
        throw new AppError(`Limite diario de ${limite} mensagens de prospeccao atingido.`, 429);
      }
    }

    try {
      const { waId, jid } = await whatsapp.enviarTexto(destino, corpo);

      // guarda o endereco confirmado: os proximos envios nao precisam consultar
      if (jid && lead.wa_jid !== jid) leadRepo.atualizar(lead.id, { wa_jid: jid });

      const msg = messageRepo.registrar({
        lead_id: lead.id,
        campaign_id: campanha?.id ?? null,
        direcao: 'OUT',
        corpo,
        telefone: lead.telefone_e164,
        wa_message_id: waId,
        status: 'ENVIADA',
        autor
      });

      const atualizado = leadRepo.marcarContatado(lead.id, corpo, {
        removerDaProspeccao: removerDaProspeccao ?? Boolean(cfg.remover_da_prospeccao_ao_contatar)
      });

      historyRepo.registrar({
        lead: atualizado,
        campaign_id: campanha?.id ?? null,
        campanha_nome: campanha?.nome ?? null,
        tipo: 'ENVIO',
        mensagem: corpo,
        status: 'ENVIADA',
        etiqueta: atualizado.etiqueta
      });

      // Primeiro contato move a etapa do funil (spec 74).
      if (atualizado.pipeline === 'NOVO') {
        leadRepo.atualizar(atualizado.id, { pipeline: 'CONTATADO' });
      }

      ActivityService.registrar({
        lead_id: atualizado.id,
        tipo: 'MENSAGEM_ENVIADA',
        descricao: corpo.slice(0, 180),
        meta: { autor, campanha: campanha?.nome || null, message_id: msg.id }
      });

      logger.ok('envio', `Mensagem enviada para ${atualizado.nome_estabelecimento}`);
      bus.emit(EVENTOS.MENSAGEM_ENVIADA, { lead: atualizado, mensagem: msg });
      bus.emit(EVENTOS.LEAD_ATUALIZADO, { lead: atualizado });
      bus.emit(EVENTOS.STATS, {});

      return { mensagem: msg, lead: atualizado };
    } catch (err) {
      const amigavel = mensagemAmigavel(err);
      messageRepo.registrar({
        lead_id: lead.id,
        campaign_id: campanha?.id ?? null,
        direcao: 'OUT',
        corpo,
        telefone: lead.telefone_e164,
        status: 'FALHOU',
        erro: amigavel,
        autor
      });
      historyRepo.registrar({
        lead,
        campaign_id: campanha?.id ?? null,
        campanha_nome: campanha?.nome ?? null,
        tipo: 'ERRO',
        mensagem: corpo,
        status: 'FALHOU',
        resposta: amigavel
      });
      logger.erro('envio', `Falha ao enviar para ${lead.nome_estabelecimento}: ${amigavel}`);
      throw new AppError(amigavel, err.status || 502);
    }
  }
};

export default MessageService;
