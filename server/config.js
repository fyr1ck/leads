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
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    // Modelo menor para classificar respostas: separa o limite por minuto do
    // modelo de geracao e responde mais rapido.
    modelAnalise: process.env.GROQ_MODEL_ANALISE || process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
    temperature: num(process.env.GROQ_TEMPERATURE, 0.6),
    // gpt-oss "pensa" antes de responder e isso consome tokens de saida.
    // low = raciocinio curto: resposta inteira e menos gasto do limite por minuto.
    reasoningEffort: ['low', 'medium', 'high'].includes(process.env.GROQ_REASONING_EFFORT)
      ? process.env.GROQ_REASONING_EFFORT
      : 'low',
    baseUrl: 'https://api.groq.com/openai/v1'
  },
  whatsapp: {
    deviceName: process.env.WA_DEVICE_NAME || 'Henvix Painel',
    sessionDir: paths.waSession
  },
  /**
   * Quem pode entrar no painel. So estes e-mails existem como usuario -
   * qualquer outro e recusado, mesmo sabendo a senha.
   */
  auth: {
    permitidos: String(process.env.USUARIOS_PERMITIDOS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    // Painel local: o login existe para proteger se a maquina for compartilhada
    // ou se voce expuser a porta na rede.
    exigirLogin: String(process.env.EXIGIR_LOGIN ?? '1') !== '0',
    // Publicado atras de HTTPS? Ligue para o cookie de sessao so viajar cifrado.
    cookieSeguro: String(process.env.COOKIE_SEGURO ?? '0') === '1'
  },
  // Fonte de dados publicos de estabelecimentos (spec 59.18: so API oficial).
  places: {
    apiKey: process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || '',
    maxResultados: num(process.env.PLACES_MAX_RESULTADOS, 60)
  },
  operacao: {
    limiteDiario: num(process.env.LIMITE_DIARIO, 30),
    delayMin: num(process.env.DELAY_MIN, 60),
    delayMax: num(process.env.DELAY_MAX, 180),
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
