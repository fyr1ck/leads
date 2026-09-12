import { Router } from 'express';
import SkillService from '../services/ai/SkillService.js';
import { carregarSkill } from '../services/ai/skillLoader.js';
import { AppError } from '../utils/errors.js';

const router = Router();

/** Conteudo da Skill + configuracao comercial (spec 65). */
router.get('/', (req, res) => {
  res.json({
    arquivo: SkillService.lerArquivo(),
    config: SkillService.lerConfig(),
    campos: Object.keys(SkillService.CONFIG_PADRAO),
    backups: SkillService.listarBackups()
  });
});

router.put('/', (req, res) => {
  const { conteudo, config } = req.body || {};
  const saida = {};
  if (typeof conteudo === 'string') saida.arquivo = SkillService.salvarArquivo(conteudo);
  if (config && typeof config === 'object') saida.config = SkillService.salvarConfig(config);
  if (!saida.arquivo && !saida.config) throw new AppError('Nada para salvar.');
  res.json({
    arquivo: saida.arquivo || SkillService.lerArquivo(),
    config: saida.config || SkillService.lerConfig()
  });
});

router.post('/reload', (req, res) => {
  carregarSkill({ forcar: true });
  res.json(SkillService.lerArquivo());
});

export default router;
