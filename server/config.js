import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

/** Resolve um caminho relativo do .env para caminho absoluto dentro do projeto. */
function resolvePath(value, fallback) {
  const raw = (value || fallback || '').replace(/^file:/, '').trim();
  return path.isAbsolute(raw) ? raw : path.resolve(ROOT, raw);
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const paths = {
  root: ROOT,
  data: path.resolve(ROOT, 'data'),
  db: resolvePath(process.env.DATABASE_URL, './data/henvix.db'),
  waSession: resolvePath(process.env.WA_SESSION_DIR, './data/wa-session'),
  uploads: path.resolve(ROOT, 'data', 'uploads'),
  exports: path.resolve(ROOT, 'data', 'exports'),
  skill: resolvePath(process.env.HENVIX_SKILL_PATH, './skills/Skill_Henvix_atualizada.md'),
  clientDist: path.resolve(ROOT, 'client', 'dist')
};

for (const dir of [paths.data, paths.waSession, paths.uploads, paths.exports]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 3001),
  webPort: num(process.env.WEB_PORT, 3000),
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    temperature: num(process.env.GROQ_TEMPERATURE, 0.6),
    baseUrl: 'https://api.groq.com/openai/v1'
  },
  whatsapp: {
    deviceName: process.env.WA_DEVICE_NAME || 'Henvix Painel',
    sessionDir: paths.waSession
  },
  operacao: {
    limiteDiario: num(process.env.LIMITE_DIARIO, 200),
    delayMin: num(process.env.DELAY_MIN, 30),
    delayMax: num(process.env.DELAY_MAX, 90),
    blocoTamanho: num(process.env.BLOCO_TAMANHO, 10),
    blocoPausaMinutos: num(process.env.BLOCO_PAUSA_MINUTOS, 5),
    maxErrosConsecutivos: num(process.env.MAX_ERROS_CONSECUTIVOS, 3),
    linkDemonstracao: process.env.LINK_DEMONSTRACAO || ''
  },
  /**
   * REGRA DE OURO (spec 15 / 28 / 50): o sistema NUNCA responde um cliente
   * automaticamente. Nao existe caminho de codigo que envie a sugestao da IA.
   * A flag existe apenas para ser exibida como DESATIVADA e travada no painel.
   */
  ia: {
    analiseAutomatica: true,
    respostaAutomatica: false
  }
};

export const hasGroqKey = () => Boolean(config.groq.apiKey);
