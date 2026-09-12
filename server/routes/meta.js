import { Router } from 'express';
import * as tagRepo from '../repositories/tagRepo.js';
import * as settingsRepo from '../repositories/settingsRepo.js';
import * as logRepo from '../repositories/logRepo.js';
import * as messageRepo from '../repositories/messageRepo.js';
import * as historyRepo from '../repositories/historyRepo.js';
import StatsService from '../services/StatsService.js';
import ExportService from '../services/ExportService.js';
import ActivityService from '../services/ActivityService.js';
import DemoService from '../services/DemoService.js';
import SalesService from '../services/SalesService.js';
import { all } from '../db/index.js';
import AIService from '../services/ai/AIService.js';
import whatsapp from '../services/whatsapp/WhatsAppService.js';
import { estatisticasBanco } from '../db/index.js';
import { asyncHandler } from '../middleware/index.js';
import { AppError } from '../utils/errors.js';
import { PIPELINE, PRIORIDADES } from '../domain/classificacao.js';
import { contextoDeHorario } from '../utils/greeting.js';

const router = Router();

// ------------------------------------------------------------------ etiquetas
router.get('/tags', (req, res) => res.json(tagRepo.listar()));
router.post('/tags', (req, res) => res.status(201).json(tagRepo.criar(req.body || {})));
router.delete('/tags/:slug', (req, res) => res.json(tagRepo.excluir(req.params.slug)));

// ------------------------------------------------------------------ dominio
router.get('/dominio', (req, res) =>
  res.json({ pipeline: PIPELINE, prioridades: PRIORIDADES, etiquetas: tagRepo.listar(), horario: contextoDeHorario() })
);

// ------------------------------------------------------------------ stats
router.get('/stats', (req, res) => res.json(StatsService.dashboard()));
router.get('/stats/graficos', (req, res) => res.json(StatsService.graficos({ dias: req.query.dias })));
router.get('/stats/oportunidades', (req, res) => res.json(StatsService.oportunidadesQuentes(req.query.limite)));

// ------------------------------------------------------------------ mensagens
router.get('/messages', (req, res) => {
  const { direcao, leadId, limite, offset } = req.query;
  res.json(messageRepo.listar({ direcao, leadId, limite, offset }));
});

// ------------------------------------------------------------------ historico
router.get('/historico', (req, res) => res.json(historyRepo.listar({ tipo: req.query.tipo, limite: req.query.limite })));

// ------------------------------------------------------------------ logs
router.get('/logs', (req, res) => res.json(logRepo.listar({ limite: req.query.limite, nivel: req.query.nivel })));

// ------------------------------------------------------------ timeline (76)
router.get('/activities', (req, res) => {
  const { leadId, limite } = req.query;
  res.json(
    leadId
      ? ActivityService.doLead(Number(leadId), Number(limite) || 100)
      : ActivityService.recentes(Number(limite) || 50)
  );
});

// ------------------------------------------------------- notificacoes (75)
router.get('/notifications', (req, res) =>
  res.json({
    itens: ActivityService.listarNotificacoes({
      limite: Number(req.query.limite) || 40,
      apenasNaoLidas: req.query.naoLidas === 'sim'
    }),
    naoLidas: ActivityService.naoLidas()
  })
);
router.post('/notifications/:id/lida', (req, res) =>
  res.json({ ok: true, marcadas: ActivityService.marcarLida(Number(req.params.id)), naoLidas: ActivityService.naoLidas() })
);
router.post('/notifications/lidas', (req, res) =>
  res.json({ ok: true, marcadas: ActivityService.marcarTodasLidas(), naoLidas: 0 })
);

// ----------------------------------------------------------- relatorios (72)
router.get('/reports', (req, res) => {
  const dias = Number(req.query.dias) || 30;
  res.json({
    dashboard: StatsService.dashboard(),
    graficos: StatsService.graficos({ dias }),
    funil: StatsService.funil(),
    demos: DemoService.estatisticas(),
    financeiro: SalesService.metricas(),
    campanhas: campanhasComMetricas()
  });
});

/** Metricas por campanha (spec 69). */
function campanhasComMetricas() {
  return all(
    `SELECT c.id, c.nome, c.status, c.tipo, c.nicho, c.localizacao, c.created_at,
            c.enviados, c.erros, c.ignorados, c.quantidade_alvo,
            (SELECT COUNT(*) FROM campaign_leads cl WHERE cl.campaign_id = c.id) AS leads,
            (SELECT COUNT(*) FROM campaign_leads cl JOIN leads l ON l.id = cl.lead_id
              WHERE cl.campaign_id = c.id AND l.respondeu = 1) AS respostas,
            (SELECT COUNT(*) FROM campaign_leads cl JOIN leads l ON l.id = cl.lead_id
              WHERE cl.campaign_id = c.id AND l.etiqueta IN ('INTERESSADO','PEDIU_DEMONSTRACAO','QUER_SABER_PRECO','NEGOCIANDO','QUER_CONTRATAR')) AS interessados,
            (SELECT COUNT(DISTINCT d.lead_id) FROM demos d JOIN campaign_leads cl ON cl.lead_id = d.lead_id
              WHERE cl.campaign_id = c.id) AS demos,
            (SELECT COUNT(*) FROM campaign_leads cl JOIN leads l ON l.id = cl.lead_id
              WHERE cl.campaign_id = c.id AND l.pipeline = 'NEGOCIACAO') AS negociacoes,
            (SELECT COUNT(*) FROM campaign_leads cl JOIN leads l ON l.id = cl.lead_id
              WHERE cl.campaign_id = c.id AND l.status = 'FECHADO') AS fechamentos
       FROM campaigns c ORDER BY c.id DESC LIMIT 50`
  ).map((c) => ({
    ...c,
    taxa_resposta: c.enviados ? Number(((c.respostas / c.enviados) * 100).toFixed(1)) : 0,
    taxa_interesse: c.respostas ? Number(((c.interessados / c.respostas) * 100).toFixed(1)) : 0,
    taxa_demo: c.respostas ? Number(((c.demos / c.respostas) * 100).toFixed(1)) : 0,
    taxa_conversao: c.enviados ? Number(((c.fechamentos / c.enviados) * 100).toFixed(1)) : 0
  }));
}

router.get('/reports/campanhas', (req, res) => res.json(campanhasComMetricas()));

// ------------------------------------------------------------------ settings
router.get('/settings', (req, res) => res.json(settingsRepo.obterTodas()));
router.put('/settings', (req, res) => {
  const patch = { ...(req.body || {}) };
  const delayMin = Number(patch.delay_min ?? settingsRepo.obter('delay_min'));
  const delayMax = Number(patch.delay_max ?? settingsRepo.obter('delay_max'));
  if (delayMin < 1) throw new AppError('O delay minimo precisa ser de pelo menos 1 segundo.');
  if (delayMax < delayMin) throw new AppError('O delay maximo precisa ser maior ou igual ao minimo.');
  res.json(settingsRepo.salvar(patch));
});

// ------------------------------------------------------------------ export
const baixar = (res) => async (gerar) => {
  const { arquivo, total } = await gerar();
  res.download(arquivo, (err) => {
    if (!err) return;
    if (!res.headersSent) res.status(500).json({ erro: 'Nao foi possivel enviar o arquivo.' });
  });
  return total;
};

router.get('/export/restantes', asyncHandler(async (req, res) => baixar(res)(ExportService.exportarRestantes)));
router.get('/export/historico', asyncHandler(async (req, res) => baixar(res)(ExportService.exportarHistorico)));
router.get('/export/crm', asyncHandler(async (req, res) => baixar(res)(ExportService.exportarCrm)));

// ------------------------------------------------------------------ saude
router.get(
  '/health',
  asyncHandler(async (req, res) => {
    const ia = await AIService.status();
    res.json({
      ok: true,
      banco: { online: true, ...estatisticasBanco() },
      whatsapp: whatsapp.estado(),
      ia,
      uptimeSegundos: Math.round(process.uptime()),
      horario: contextoDeHorario()
    });
  })
);

export default router;
