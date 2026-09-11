import { config, hasGroqKey } from '../../config.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

/**
 * Cliente da Groq. Roda SOMENTE no backend local (spec 19 / 1.1):
 * frontend -> backend local -> Groq. A chave nunca sai daqui.
 */
const TIMEOUT_MS = 45_000;

async function chamar(caminho, { method = 'POST', body, timeout = TIMEOUT_MS } = {}) {
  if (!hasGroqKey()) {
    throw new AppError('GROQ_API_KEY nao configurada no arquivo .env.', 503);
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch(`${config.groq.baseUrl}${caminho}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.groq.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });

    const texto = await resp.text();
    let dados = null;
    try {
      dados = texto ? JSON.parse(texto) : null;
    } catch {
      dados = { raw: texto };
    }

    if (!resp.ok) {
      const detalhe = dados?.error?.message || `HTTP ${resp.status}`;
      const err = new AppError(`Groq: ${detalhe}`, resp.status === 401 ? 401 : 502);
      err.groqStatus = resp.status;
      throw err;
    }
    return dados;
  } catch (err) {
    if (err.name === 'AbortError') throw new AppError('A Groq demorou demais para responder.', 504);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/** Retenta apenas em 429/5xx - erro de chave nao adianta repetir. */
async function comRetry(fn, tentativas = 2) {
  let ultimo;
  for (let i = 0; i <= tentativas; i += 1) {
    try {
      return await fn();
    } catch (err) {
      ultimo = err;
      const status = err.groqStatus || err.status;
      const recuperavel = status === 429 || (status >= 500 && status < 600) || status === 504;
      if (!recuperavel || i === tentativas) break;
      const espera = 1200 * (i + 1);
      logger.warn('groq', `Tentativa ${i + 1} falhou (${status}). Repetindo em ${espera}ms.`);
      await new Promise((r) => setTimeout(r, espera));
    }
  }
  throw ultimo;
}

export async function completar({ sistema, usuario, json = false, temperatura, maxTokens = 700 }) {
  const dados = await comRetry(() =>
    chamar('/chat/completions', {
      body: {
        model: config.groq.model,
        temperature: temperatura ?? config.groq.temperature,
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: sistema },
          { role: 'user', content: usuario }
        ]
      }
    })
  );
  const conteudo = dados?.choices?.[0]?.message?.content ?? '';
  return { conteudo, modelo: dados?.model || config.groq.model, uso: dados?.usage || null };
}

/** Checagem de saude exibida no painel e no banner do terminal. */
export async function verificarConexao() {
  if (!hasGroqKey()) return { conectado: false, motivo: 'GROQ_API_KEY nao configurada', modelo: config.groq.model };
  try {
    const dados = await chamar('/models', { method: 'GET', body: null, timeout: 12_000 });
    const modelos = (dados?.data || []).map((m) => m.id);
    const existe = modelos.includes(config.groq.model);
    return {
      conectado: true,
      modelo: config.groq.model,
      modeloDisponivel: existe,
      totalModelos: modelos.length,
      motivo: existe ? null : `O modelo ${config.groq.model} nao aparece na sua conta Groq.`
    };
  } catch (err) {
    return { conectado: false, modelo: config.groq.model, motivo: err.message };
  }
}
