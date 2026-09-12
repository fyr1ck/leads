import { Router } from 'express';
import ReactivationService from '../services/ReactivationService.js';
import * as settingsRepo from '../repositories/settingsRepo.js';
import { AppError } from '../utils/errors.js';

const router = Router();

router.get('/', (req, res) => {
  const dias = Number(req.query.dias) || Number(settingsRepo.obter('reativacao_dias')) || 15;
  res.json(ReactivationService.candidatos({ dias, grupo: req.query.grupo, limite: Number(req.query.limite) || 200 }));
});

router.get('/resumo', (req, res) => {
  const dias = Number(req.query.dias) || Number(settingsRepo.obter('reativacao_dias')) || 15;
  res.json(ReactivationService.resumo({ dias }));
});

/** Cria a campanha de reativacao com os leads escolhidos (spec 70). */
router.post('/campanha', (req, res) => {
  const ids = (req.body?.leadIds || []).map(Number).filter(Boolean);
  if (!ids.length) throw new AppError('Selecione os leads que devem ser reativados.');
  const cfg = settingsRepo.obterTodas();
  res.status(201).json(
    ReactivationService.criarCampanha({
      leadIds: ids,
      nome: req.body?.nome,
      delayMin: Number(req.body?.delayMin ?? cfg.delay_min),
      delayMax: Number(req.body?.delayMax ?? cfg.delay_max),
      blocoTamanho: Number(req.body?.blocoTamanho ?? cfg.bloco_tamanho),
      blocoPausaMinutos: Number(req.body?.blocoPausaMinutos ?? cfg.bloco_pausa_minutos)
    })
  );
});

export default router;
