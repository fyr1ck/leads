/** Erro de aplicacao com status HTTP e mensagem amigavel (spec 46). */
export class AppError extends Error {
  constructor(mensagem, status = 400, detalhe = null) {
    super(mensagem);
    this.name = 'AppError';
    this.status = status;
    this.detalhe = detalhe;
  }
}

export const naoEncontrado = (o = 'Registro') => new AppError(`${o} nao encontrado.`, 404);

/** Traduz erro tecnico em mensagem que o operador entende (spec 46). */
export function mensagemAmigavel(err) {
  const raw = String(err?.message || err || '');
  if (/not connected|Connection Closed|no session|precondition|not open/i.test(raw)) {
    return 'Nao foi possivel enviar a mensagem. O WhatsApp pode estar desconectado.';
  }
  if (/nao esta no whatsapp|not on whatsapp/i.test(raw)) {
    return 'Esse numero nao tem WhatsApp ativo.';
  }
  if (/timed? ?out|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|fetch failed/i.test(raw)) {
    return 'Falha de conexao com o servico. Verifique a internet e tente novamente.';
  }
  if (/GROQ_API_KEY|401|invalid[_ ]api[_ ]key/i.test(raw)) {
    return 'A Groq recusou a requisicao. Confira a GROQ_API_KEY no arquivo .env.';
  }
  if (/429|rate limit/i.test(raw)) {
    return 'Limite de requisicoes da IA atingido. Aguarde alguns segundos e tente de novo.';
  }
  if (/UNIQUE constraint/i.test(raw)) return 'Esse registro ja existe no banco.';
  return raw || 'Erro inesperado.';
}
