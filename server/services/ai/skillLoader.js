import fs from 'node:fs';
import { paths } from '../../config.js';
import { logger } from '../../utils/logger.js';

/**
 * Carrega a SKILL DE VENDAS DA HENVIX (spec 2 / 21).
 * A Skill e a fonte principal das regras comerciais: o conteudo vai INTEIRO
 * para o system prompt. O sistema nunca cria uma estrategia propria.
 */
let cache = { conteudo: null, mtime: 0, caminho: paths.skill };

export function carregarSkill({ forcar = false } = {}) {
  try {
    const stat = fs.statSync(paths.skill);
    const mtime = stat.mtimeMs;
    if (!forcar && cache.conteudo && cache.mtime === mtime) return cache.conteudo;
    const conteudo = fs.readFileSync(paths.skill, 'utf8');
    cache = { conteudo, mtime, caminho: paths.skill };
    logger.ok('skill', `Skill Henvix carregada (${conteudo.length} caracteres).`);
    return conteudo;
  } catch (err) {
    if (cache.conteudo) return cache.conteudo;
    logger.erro(
      'skill',
      `Arquivo da Skill nao encontrado em ${paths.skill}. Ajuste HENVIX_SKILL_PATH no .env.`
    );
    return null;
  }
}

export function infoSkill() {
  const conteudo = carregarSkill();
  return {
    caminho: paths.skill,
    carregada: Boolean(conteudo),
    caracteres: conteudo?.length || 0,
    atualizadaEm: cache.mtime ? new Date(cache.mtime).toISOString() : null
  };
}
