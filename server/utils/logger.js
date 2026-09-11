import { bus } from '../realtime/bus.js';

const CORES = {
  info: '\x1b[36m',
  ok: '\x1b[32m',
  warn: '\x1b[33m',
  erro: '\x1b[31m',
  debug: '\x1b[90m'
};
const RESET = '\x1b[0m';

/** Remove qualquer coisa parecida com credencial antes de logar (spec 40 / 53). */
function sanitize(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/(gsk_[A-Za-z0-9]{4})[A-Za-z0-9_-]+/g, '$1***')
    .replace(/(api[-_ ]?key["':\s=]+)[^\s"',}]+/gi, '$1***')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, '$1***');
}

const hora = () => new Date().toLocaleTimeString('pt-BR', { hour12: false });

function emit(nivel, categoria, mensagem, meta) {
  const texto = sanitize(String(mensagem));
  const cor = CORES[nivel] || CORES.info;
  console.log(`${CORES.debug}${hora()}${RESET} ${cor}[${categoria}]${RESET} ${texto}`);
  // Quem persiste/transmite o log escuta o bus (evita import circular com o banco).
  bus.emit('log', {
    nivel,
    categoria,
    mensagem: texto,
    meta: meta ?? null,
    created_at: new Date().toISOString()
  });
}

export const logger = {
  info: (categoria, mensagem, meta) => emit('info', categoria, mensagem, meta),
  ok: (categoria, mensagem, meta) => emit('ok', categoria, mensagem, meta),
  warn: (categoria, mensagem, meta) => emit('warn', categoria, mensagem, meta),
  erro: (categoria, mensagem, meta) => emit('erro', categoria, mensagem, meta),
  debug: (categoria, mensagem, meta) => {
    if (process.env.DEBUG) emit('debug', categoria, mensagem, meta);
  },
  sanitize
};
