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
      // A Groq diz exatamente quanto esperar quando estoura o limite por minuto.
      err.esperaMs = esperaSugerida(resp, dados);
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

/**
 * Quanto esperar antes de tentar de novo.
 * A Groq manda o tempo no header `retry-after` e tambem no texto do erro
 * ("Please try again in 25.0875s") - obedecer isso e o que faz o limite de
 * tokens por minuto do plano gratuito nao derrubar a campanha.
 */
const TETO_ESPERA_MS = 40_000;

function esperaSugerida(resp, dados) {
  const header = Number(resp.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.min(TETO_ESPERA_MS, header * 1000);
  const m = /try again in ([\d.]+)\s*s/i.exec(dados?.error?.message || '');
  if (m) return Math.min(TETO_ESPERA_MS, Math.ceil(parseFloat(m[1]) * 1000) + 500);
  return null;
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
      const espera = err.esperaMs ?? 1200 * (i + 1);
      const motivo = status === 429 ? 'limite de tokens por minuto' : `erro ${status}`;
      logger.warn('groq', `Tentativa ${i + 1} barrada (${motivo}). Aguardando ${Math.round(espera / 1000)}s.`);
      await new Promise((r) => setTimeout(r, espera));
    }
  }
  throw ultimo;
}

/** Modelos que já recusaram structured output nesta execução. */
const semSchema = new Set();

/**
 * `esquema` liga o structured output da Groq: o modelo é obrigado a devolver
 * exatamente o formato pedido. Se o modelo escolhido não suportar (ou falhar a
 * validação), caímos para JSON simples e, por último, para texto puro — o
 * AIService ainda consegue extrair o JSON do texto.
 */
export async function completar({ sistema, usuario, json = false, esquema, temperatura, maxTokens = 700, modelo }) {
  const mensagens = [
    { role: 'system', content: sistema },
    { role: 'user', content: usuario }
  ];
  const modeloUsado = modelo || config.groq.model;

  const formatos = [];
  if (esquema && !semSchema.has(modeloUsado)) {
    formatos.push({ type: 'json_schema', json_schema: { name: 'analise', strict: true, schema: esquema } });
  }
  if (json || esquema) formatos.push({ type: 'json_object' });
  formatos.push(null);

  let ultimo;
  for (const response_format of formatos) {
    try {
      const dados = await comRetry(() =>
        chamar('/chat/completions', {
          body: {
            model: modeloUsado,
            temperature: temperatura ?? config.groq.temperature,
            max_tokens: maxTokens,
            ...(response_format ? { response_format } : {}),
            messages: mensagens
          }
        })
      );
      const conteudo = dados?.choices?.[0]?.message?.content ?? '';
      return { conteudo, modelo: dados?.model || modeloUsado, uso: dados?.usage || null };
    } catch (err) {
      ultimo = err;
      const texto = String(err.message || '');
      const problemaDeFormato = /json|response_format|schema/i.test(texto) && err.groqStatus === 400;
      if (!problemaDeFormato) throw err;
      if (response_format?.type === 'json_schema') {
        // Não insiste no schema com esse modelo: cada tentativa extra consome
        // tokens do limite por minuto.
        semSchema.add(modeloUsado);
      }
      logger.warn('groq', `Formato de resposta recusado pelo modelo (${response_format?.type || 'texto'}). Tentando o próximo.`);
    }
  }
  throw ultimo;
}

/** Checagem de saude exibida no painel e no banner do terminal. */
export async function verificarConexao() {
  if (!hasGroqKey()) return { conectado: false, motivo: 'GROQ_API_KEY nao configurada', modelo: config.groq.model };
  try {
    const dados = await chamar('/models', { method: 'GET', body: null, timeout: 12_000 });
    const modelos = (dados?.data || []).map((m) => m.id);
    const existe = modelos.includes(config.groq.model);
    const existeAnalise = modelos.includes(config.groq.modelAnalise);
    const faltando = [
      existe ? null : config.groq.model,
      existeAnalise ? null : config.groq.modelAnalise
    ].filter(Boolean);
    return {
      conectado: true,
      modelo: config.groq.model,
      modeloAnalise: config.groq.modelAnalise,
      modeloDisponivel: existe && existeAnalise,
      totalModelos: modelos.length,
      motivo: faltando.length
        ? `Nao encontrei na sua conta Groq: ${faltando.join(', ')}. Ajuste GROQ_MODEL / GROQ_MODEL_ANALISE no .env.`
        : null
    };
  } catch (err) {
    return { conectado: false, modelo: config.groq.model, modeloAnalise: config.groq.modelAnalise, motivo: err.message };
  }
}
