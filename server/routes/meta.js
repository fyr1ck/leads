import { Router } from 'express';
import * as tagRepo from '../repositories/tagRepo.js';
import * as settingsRepo from '../repositories/settingsRepo.js';
import * as logRepo from '../repositories/logRepo.js';
import * as messageRepo from '../repositories/messageRepo.js';
import * as historyRepo from '../repositories/historyRepo.js';
import StatsService from '../services/StatsService.js';
import ExportService from '../services/ExportService.js';
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
