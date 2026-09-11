import { Server } from 'socket.io';
import { bus, EVENTOS } from './bus.js';
import { config } from '../config.js';
import whatsapp from '../services/whatsapp/WhatsAppService.js';
import campaignRunner from '../services/CampaignRunner.js';
import * as campaignRepo from '../repositories/campaignRepo.js';
import * as logRepo from '../repositories/logRepo.js';
import StatsService from '../services/StatsService.js';
import AIService from '../services/ai/AIService.js';

/**
 * Ponte entre o bus interno e o painel (spec 5 / 49).
 * Tudo que muda no backend chega na tela sem recarregar a pagina.
 */
export function criarSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: [
        `http://localhost:${config.webPort}`,
        `http://127.0.0.1:${config.webPort}`,
        `http://localhost:${config.port}`
      ],
      methods: ['GET', 'POST']
    },
    path: '/socket.io'
  });

  // A persistencia do log fica no index.js; aqui apenas espelhamos na tela.
  bus.on(EVENTOS.LOG, (entrada) => io.emit(EVENTOS.LOG, entrada));

  const repassar = [
    EVENTOS.WHATSAPP_STATUS,
    EVENTOS.WHATSAPP_QR,
    EVENTOS.CAMPANHA_PROGRESSO,
    EVENTOS.CAMPANHA_STATUS,
    EVENTOS.MENSAGEM_ENVIADA,
    EVENTOS.MENSAGEM_RECEBIDA,
    EVENTOS.LEAD_ATUALIZADO,
    EVENTOS.ANALISE_PRONTA,
    EVENTOS.IMPORTACAO,
    EVENTOS.ALERTA
  ];
  for (const evento of repassar) bus.on(evento, (payload) => io.emit(evento, payload));

  // stats: agrupa rajadas para nao inundar o socket durante uma campanha
  let statsTimer = null;
  bus.on(EVENTOS.STATS, () => {
    if (statsTimer) return;
    statsTimer = setTimeout(() => {
      statsTimer = null;
      try {
        io.emit(EVENTOS.STATS, StatsService.dashboard());
      } catch {
        /* ignora falha de leitura momentanea */
      }
    }, 700);
  });

  io.on('connection', async (socket) => {
    // Estado inicial completo: a tela nasce sincronizada.
    socket.emit('estado:inicial', {
      whatsapp: whatsapp.estado(),
      campanhas: campaignRepo.ativas().map((c) => campaignRunner.estado(c.id)).filter(Boolean),
      stats: StatsService.dashboard(),
      logs: logRepo.listar({ limite: 60 }).reverse(),
      ia: { configurada: AIService.disponivel(), respostaAutomatica: false }
    });
  });

  return io;
}
