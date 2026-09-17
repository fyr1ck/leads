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

  // Erros da Groq decidem pelo status HTTP real, nunca por numero solto no
  // texto: "Used 7401 tokens" contem "401" e aparecia como "chave invalida".
  const statusGroq = err?.groqStatus;
  if (statusGroq === 429 || /rate limit|tokens per minute|requests per minute/i.test(raw)) {
    if (err?.esperaMs > 60_000 || /tokens per day|limite diario/i.test(raw)) {
      const min = err?.esperaMs ? Math.ceil(err.esperaMs / 60_000) : null;
      return `A IA atingiu o limite diario do plano gratuito da Groq. ${
        min ? `Volta em cerca de ${min} min.` : 'Tente de novo mais tarde.'
      }`;
    }
    const seg = err?.esperaMs ? Math.ceil(err.esperaMs / 1000) : null;
    return `A IA atingiu o limite de uso por minuto do plano gratuito da Groq. ${
      seg ? `Tente de novo em ${seg}s.` : 'Aguarde cerca de um minuto e tente de novo.'
    }`;
  }
  if (statusGroq === 401 || statusGroq === 403 || /invalid[_ ]api[_ ]key|GROQ_API_KEY nao configurada/i.test(raw)) {
    return 'A Groq recusou a chave. Confira a GROQ_API_KEY no arquivo .env.';
  }

  if (/not connected|Connection Closed|no session|precondition|not open/i.test(raw)) {
    return 'Nao foi possivel enviar a mensagem. O WhatsApp pode estar desconectado.';
  }
  if (/nao esta no whatsapp|not on whatsapp/i.test(raw)) {
    return 'Esse numero nao tem WhatsApp ativo.';
  }
  if (/timed? ?out|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|fetch failed/i.test(raw)) {
    return 'Falha de conexao com o servico. Verifique a internet e tente novamente.';
  }
  if (/UNIQUE constraint/i.test(raw)) return 'Esse registro ja existe no banco.';
  return raw || 'Erro inesperado.';
}
