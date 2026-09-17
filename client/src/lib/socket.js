import { io } from 'socket.io-client';

/**
 * Conexao em tempo real com o backend local (spec 5 / 49).
 * O Vite faz proxy de /socket.io para a API, entao usamos a mesma origem.
 */
export const socket = io('/', {
  path: '/socket.io',
  // so conecta depois do login e com os ouvintes prontos (AppContext). Conectando
  // no import, o "connect" e o estado inicial chegavam antes de alguem escutar e
  // o painel ficava com "Servidor offline" / "WhatsApp desconectado" para sempre.
  autoConnect: false,
  transports: ['websocket', 'polling'],
  reconnectionDelay: 900,
  reconnectionDelayMax: 6000,
  // o cookie de sessao autentica o tempo real tambem
  withCredentials: true
});

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
  STATS: 'stats:atualizado',
  INICIAL: 'estado:inicial',
  // v2 - Sales OS
  ATIVIDADE: 'atividade:nova',
  NOTIFICACAO: 'notificacao:nova',
  BUSCA_PROGRESSO: 'busca:progresso',
  FOLLOWUP: 'followup:atualizado',
  DEMO: 'demo:atualizada',
  VENDA: 'venda:registrada'
};
