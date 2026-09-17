import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../../config.js';
import * as settingsRepo from '../../repositories/settingsRepo.js';
import { carregarSkill, infoSkill } from './skillLoader.js';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../utils/errors.js';

/**
 * Skill Henvix editavel pelo painel (spec 65).
 *
 * Duas camadas:
 *  1. o arquivo .md da Skill (a estrategia comercial em si);
 *  2. uma configuracao estruturada (tom, servicos, precos, objecoes, FAQ) que
 *     entra no system prompt junto com a Skill.
 *
 * A camada 2 existe para o operador poder informar preco real sem precisar
 * editar a Skill - e e a unica forma da IA falar de valores, ja que inventar
 * preco e proibido.
 */
const CHAVE = 'skill_config';

export const CONFIG_PADRAO = {
  tom: 'Natural, consultivo e direto. Portugues do Brasil, sem formalidade exagerada.',
  servicos: 'Landing pages e sites institucionais.',
  precos: '',
  prazo: '',
  formas_pagamento: '',
  objecoes: '',
  argumentos: '',
  faq: '',
  abordagens: '',
  followups: '',
  regras_extras: ''
};

const ROTULOS = {
  tom: 'TOM DE VOZ',
  servicos: 'SERVICOS OFERECIDOS',
  precos: 'PRECOS AUTORIZADOS',
  prazo: 'PRAZO DE ENTREGA',
  formas_pagamento: 'FORMAS DE PAGAMENTO',
  objecoes: 'OBJECOES E RESPOSTAS',
  argumentos: 'ARGUMENTOS DE VENDA',
  faq: 'PERGUNTAS FREQUENTES',
  abordagens: 'ABORDAGENS PREFERIDAS',
  followups: 'ORIENTACAO PARA FOLLOW-UP',
  regras_extras: 'REGRAS ADICIONAIS'
};

export function lerConfig() {
  const bruto = settingsRepo.obter(CHAVE);
  if (!bruto) return { ...CONFIG_PADRAO };
  try {
    return { ...CONFIG_PADRAO, ...JSON.parse(bruto) };
  } catch {
    return { ...CONFIG_PADRAO };
  }
}

export function salvarConfig(patch = {}) {
  const atual = lerConfig();
  const novo = { ...atual };
  for (const chave of Object.keys(CONFIG_PADRAO)) {
    if (patch[chave] !== undefined) novo[chave] = String(patch[chave] ?? '').slice(0, 4000);
  }
  settingsRepo.salvar({ [CHAVE]: JSON.stringify(novo) });
  logger.ok('skill', 'Configuracao comercial da Skill atualizada.');
  return novo;
}

/**
 * Bloco que vai para o system prompt.
 * So entra o que o operador preencheu - campo vazio nao vira instrucao.
 */
export function blocoConfig() {
  const cfg = lerConfig();
  const partes = Object.entries(ROTULOS)
    .filter(([chave]) => String(cfg[chave] || '').trim())
    .map(([chave, rotulo]) => `${rotulo}:\n${String(cfg[chave]).trim()}`);

  if (!partes.length) return '';

  const temPreco = String(cfg.precos || '').trim().length > 0;
  return [
    '===== CONFIGURACAO COMERCIAL DEFINIDA PELO OPERADOR =====',
    ...partes,
    '',
    temPreco
      ? 'Os precos acima sao os UNICOS valores autorizados. Nao invente outros, nao arredonde, nao crie desconto.'
      : 'Nenhum preco foi autorizado: NAO informe valores. Se perguntarem, explique o servico e diga que vai confirmar o valor.',
    '===== FIM DA CONFIGURACAO ====='
  ].join('\n');
}

export function lerArquivo() {
  const conteudo = carregarSkill();
  return { ...infoSkill(), conteudo: conteudo || '' };
}

/** Salva a Skill com backup do arquivo anterior. */
export function salvarArquivo(texto) {
  const conteudo = String(texto ?? '');
  if (conteudo.trim().length < 200) {
    throw new AppError('O conteudo da Skill parece curto demais. Revise antes de salvar.');
  }

  const backups = path.join(path.dirname(paths.skill), 'backups');
  fs.mkdirSync(backups, { recursive: true });

  if (fs.existsSync(paths.skill)) {
    const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    fs.copyFileSync(paths.skill, path.join(backups, `${path.basename(paths.skill, '.md')}-${carimbo}.md`));
  }

  fs.writeFileSync(paths.skill, conteudo, 'utf8');
  carregarSkill({ forcar: true });
  logger.ok('skill', `Skill salva (${conteudo.length} caracteres). Backup do arquivo anterior guardado.`);
  return lerArquivo();
}

export function listarBackups() {
  const dir = path.join(path.dirname(paths.skill), 'backups');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse()
    .slice(0, 20)
    .map((arquivo) => {
      const stat = fs.statSync(path.join(dir, arquivo));
      return { arquivo, tamanho: stat.size, criado_em: stat.mtime.toISOString() };
    });
}

export default { lerArquivo, salvarArquivo, lerConfig, salvarConfig, blocoConfig, listarBackups, CONFIG_PADRAO };
