import { EventEmitter } from 'node:events';

/**
 * Barramento interno de eventos da aplicacao.
 * Servicos emitem aqui; o socket.io (realtime/socket.js) reemite para o painel.
 * Assim nenhum servico precisa conhecer o socket - e o inverso tambem vale.
 */
export const bus = new EventEmitter();
bus.setMaxListeners(50);

export const EVENTOS = {
  LOG: 'log',
  WHATSAPP_STATUS: 'whatsapp:status',
  WHATSAPP_QR: 'whatsapp:qr',
  CAMPANHA_PROGRESSO: 'campanha:progresso',
  CAMPANHA_STATUS: 'campanha:status',
  MENSAGEM_ENVIADA: 'mensagem:enviada',
  MENSAGEM_RECEBIDA: 'mensagem:recebida',
  LEAD_ATUALIZADO: 'lead:atualizado',
  ANALISE_PRONTA: 'analise:pronta',
  IMPORTACAO: 'importacao:concluida',
  ALERTA: 'alerta',
  STATS: 'stats:atualizado'
};
