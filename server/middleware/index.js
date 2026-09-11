import { AppError, mensagemAmigavel } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/** Deixa o express repassar erros de handlers async para o errorHandler. */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(req, res) {
  res.status(404).json({ erro: `Rota nao encontrada: ${req.method} ${req.originalUrl}` });
}

/** Nenhum erro derruba o painel (spec 46). */
export function errorHandler(err, req, res, _next) {
  const status = err instanceof AppError ? err.status : err.status || 500;
  const mensagem = mensagemAmigavel(err);

  if (status >= 500) logger.erro('api', `${req.method} ${req.originalUrl} -> ${err.message}`);
  else logger.warn('api', `${req.method} ${req.originalUrl} -> ${mensagem}`);

  res.status(status).json({
    erro: mensagem,
    detalhe: err.detalhe || null,
    ...(process.env.NODE_ENV !== 'production' && status >= 500 ? { stack: err.stack } : {})
  });
}
