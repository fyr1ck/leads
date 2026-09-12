import { Router } from 'express';
import FollowUpService from '../services/FollowUpService.js';
import { asyncHandler } from '../middleware/index.js';
import { AppError } from '../utils/errors.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    itens: FollowUpService.listar({ status: req.query.status, limite: req.query.limite }),
    vencidos: FollowUpService.vencidos().length
  });
});

/** PROXIMAS ACOES do dashboard (spec 67). */
router.get('/proximas-acoes', (req, res) => res.json(FollowUpService.proximasAcoes(Number(req.query.limite) || 10)));

router.get('/vencidos', (req, res) => res.json(FollowUpService.vencidos()));

router.post('/', (req, res) => {
  const { leadId, prazoDias = 1, motivo = null } = req.body || {};
  if (!leadId) throw new AppError('Informe o lead.');
  res.status(201).json(FollowUpService.agendar(Number(leadId), { prazoDias: Number(prazoDias), motivo }));
});

/** A IA escreve; nada e enviado ainda (spec 66). */
router.post(
  '/:id/preparar',
  asyncHandler(async (req, res) => res.json(await FollowUpService.prepararComIA(Number(req.params.id))))
);

/**
 * Envio do follow-up: exige acao explicita do operador.
 * Este e o unico caminho que dispara um envio a partir de um follow-up.
 */
router.post(
  '/:id/enviar',
  asyncHandler(async (req, res) =>
    res.json(await FollowUpService.confirmarEnvio(Number(req.params.id), { texto: req.body?.texto }))
  )
);

router.post('/:id/cancelar', (req, res) =>
  res.json(FollowUpService.cancelar(Number(req.params.id), req.body?.motivo))
);

export default router;
