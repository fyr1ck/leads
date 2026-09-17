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
      const statusHttp = resp.status === 401 || resp.status === 429 ? resp.status : 502;
      const err = new AppError(`Groq: ${detalhe}`, statusHttp);
      err.groqStatus = resp.status;
      err.codigo = dados?.error?.code || null;
      // Quando o JSON sai invalido, a Groq devolve o que o modelo gerou.
      err.geracaoFalha = dados?.error?.failed_generation || null;
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

/**
 * Retenta apenas em 429/5xx - erro de chave nao adianta repetir.
 * `maxEsperaMs` limita quanto vale a pena esperar: numa acao que a pessoa esta
 * olhando (copiloto, sugestao) e melhor avisar "tente em 34s" do que travar a
 * tela; em tarefa de fundo (campanha, analise) espera o que a Groq pedir.
 */
async function comRetry(fn, tentativas = 2, { maxEsperaMs = TETO_ESPERA_MS } = {}) {
  let ultimo;
  for (let i = 0; i <= tentativas; i += 1) {
    try {
      return await fn();
    } catch (err) {
      ultimo = err;
      const status = err.groqStatus || err.status;
      const recuperavel = status === 429 || (status >= 500 && status < 600) || status === 504;
      if (!recuperavel || i === tentativas) break;
      // No 429 o "try again in 1.3s" da Groq so vale se o pedido for pequeno: com
      // a Skill inteira (~6.5k de 8k tokens/min) tentar logo estoura de novo e
      // esgota as tentativas. Espera crescente ate a janela liberar de verdade.
      const espera = status === 429 ? Math.max(err.esperaMs ?? 0, 5000 * (i + 1)) : err.esperaMs ?? 1200 * (i + 1);
      if (espera > maxEsperaMs) break;
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
 * Modelos de raciocinio (gpt-oss) gastam tokens "pensando" antes de responder,
 * e esses tokens contam no limite de saida. Com raciocinio padrao o JSON saia
 * cortado ("json_validate_failed"). Esforco baixo resolve: nos testes o
 * raciocinio caiu para poucos tokens e a resposta veio inteira.
 */
const ehModeloDeRaciocinio = (modelo) => /gpt-oss/i.test(String(modelo || ''));

/** O JSON que o modelo gerou e a Groq recusou ainda pode estar aproveitavel. */
function aproveitarGeracao(texto) {
  if (!texto) return null;
  const t = String(texto).trim();
  const ini = t.indexOf('{');
  const fim = t.lastIndexOf('}');
  if (ini < 0 || fim <= ini) return null;
  try {
    JSON.parse(t.slice(ini, fim + 1));
    return t.slice(ini, fim + 1);
  } catch {
    return null;
  }
}

/**
 * `esquema` liga o structured output da Groq: o modelo é obrigado a devolver
 * exatamente o formato pedido.
 *
 * Cada tentativa extra gasta tokens do limite por minuto, entao:
 *  - JSON invalido (json_validate_failed): primeiro aproveita o que o modelo
 *    gerou; so se nao der, tenta UMA vez em texto puro;
 *  - formato nao suportado pelo modelo: cai para json_object e depois texto,
 *    e lembra para nao insistir de novo.
 *
 * `interativo`: acao que a pessoa esta olhando - nao fica esperando o limite
 * por minuto liberar, avisa quanto tempo falta.
 */
export async function completar({
  sistema,
  usuario,
  json = false,
  esquema,
  temperatura,
  maxTokens = 700,
  modelo,
  interativo = false
}) {
  const mensagens = [
    { role: 'system', content: sistema },
    { role: 'user', content: usuario }
  ];
  const modeloUsado = modelo || config.groq.model;
  const opcoesRetry = interativo ? { maxEsperaMs: 8_000 } : {};

  const formatos = [];
  if (esquema && !semSchema.has(modeloUsado)) {
    formatos.push({ type: 'json_schema', json_schema: { name: 'analise', strict: true, schema: esquema } });
  }
  if (json || esquema) formatos.push({ type: 'json_object' });
  formatos.push(null);

  let ultimo;
  for (let i = 0; i < formatos.length; i += 1) {
    const response_format = formatos[i];
    try {
      const dados = await comRetry(
        () =>
          chamar('/chat/completions', {
            body: {
              model: modeloUsado,
              temperature: temperatura ?? config.groq.temperature,
              max_completion_tokens: maxTokens,
              ...(ehModeloDeRaciocinio(modeloUsado) ? { reasoning_effort: config.groq.reasoningEffort } : {}),
              ...(response_format ? { response_format } : {}),
              messages: mensagens
            }
          }),
        // tarefa de fundo (analise de resposta, campanha) pode esperar a janela
        // de 1 minuto; acao na tela desiste antes e avisa
        interativo ? 2 : 5,
        opcoesRetry
      );
      const conteudo = dados?.choices?.[0]?.message?.content ?? '';
      return { conteudo, modelo: dados?.model || modeloUsado, uso: dados?.usage || null };
    } catch (err) {
      ultimo = err;
      if (err.groqStatus !== 400) throw err;

      if (err.codigo === 'json_validate_failed') {
        const aproveitado = aproveitarGeracao(err.geracaoFalha);
        if (aproveitado) {
          logger.info('groq', 'JSON recusado pela validacao, mas a resposta gerada era aproveitavel.');
          return { conteudo: aproveitado, modelo: modeloUsado, uso: null };
        }
        if (response_format === null) throw err;
        // uma tentativa so, direto em texto puro (o AIService extrai o JSON)
        logger.warn('groq', 'JSON veio invalido. Tentando uma vez em texto puro.');
        i = formatos.length - 2;
        continue;
      }

      const problemaDeFormato = /json|response_format|schema/i.test(String(err.message || ''));
      if (!problemaDeFormato) throw err;
      if (response_format?.type === 'json_schema') semSchema.add(modeloUsado);
      logger.warn('groq', `Formato de resposta nao suportado (${response_format?.type || 'texto'}). Tentando o próximo.`);
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
