/**
 * Cliente da Groq com fetch simulado - nao consome a cota real.
 *
 * Trava o que derrubava o Copiloto: limite por minuto aparecendo como
 * "chave invalida", JSON cortado por raciocinio longo e retentativas que
 * gastavam o dobro de tokens.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.GROQ_API_KEY = 'gsk_teste_nao_e_real';
process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
process.env.GROQ_REASONING_EFFORT = 'low';

const { completar } = await import('../server/services/ai/GroqClient.js');
const { mensagemAmigavel } = await import('../server/utils/errors.js');

/** Troca o fetch global por respostas roteirizadas e registra os corpos enviados. */
function roteiro(respostas) {
  const chamadas = [];
  globalThis.fetch = async (_url, opcoes) => {
    chamadas.push(JSON.parse(opcoes.body));
    const r = respostas[Math.min(chamadas.length - 1, respostas.length - 1)];
    return {
      ok: r.status < 400,
      status: r.status,
      headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? r.retryAfter ?? null : null) },
      text: async () => JSON.stringify(r.body)
    };
  };
  return chamadas;
}

const ok = (conteudo) => ({ status: 200, body: { model: 'openai/gpt-oss-120b', choices: [{ message: { content: conteudo } }] } });
const esquema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };

test('limite por minuto com "7401" no texto NAO vira "chave invalida"', () => {
  const err = new Error(
    'Groq: Rate limit reached for model openai/gpt-oss-20b on tokens per minute (TPM): Limit 8000, Used 7401, Requested 4170. Please try again in 34s.'
  );
  err.groqStatus = 429;
  err.esperaMs = 34_500;
  const msg = mensagemAmigavel(err);
  assert.match(msg, /limite de uso por minuto/i);
  assert.match(msg, /35s/);
  assert.doesNotMatch(msg, /GROQ_API_KEY/);
});

test('chave recusada de verdade (401) continua apontando para a GROQ_API_KEY', () => {
  const err = new Error('Groq: Invalid API Key');
  err.groqStatus = 401;
  assert.match(mensagemAmigavel(err), /GROQ_API_KEY/);
});

test('modelo gpt-oss recebe raciocinio curto e limite de saida pelo campo novo', async () => {
  const chamadas = roteiro([ok('oi')]);
  await completar({ sistema: 's', usuario: 'u', maxTokens: 600 });
  assert.equal(chamadas[0].reasoning_effort, 'low');
  assert.equal(chamadas[0].max_completion_tokens, 600);
  assert.equal(chamadas[0].max_tokens, undefined);
});

test('JSON recusado mas aproveitavel: usa o que o modelo gerou, sem chamar de novo', async () => {
  const chamadas = roteiro([
    { status: 400, body: { error: { code: 'json_validate_failed', message: 'Failed to validate JSON', failed_generation: '{"a":"valor"}' } } }
  ]);
  const r = await completar({ sistema: 's', usuario: 'u', esquema });
  assert.equal(chamadas.length, 1, 'nenhum token extra gasto');
  assert.deepEqual(JSON.parse(r.conteudo), { a: 'valor' });
});

test('JSON cortado de verdade: UMA tentativa extra, direto em texto puro', async () => {
  const chamadas = roteiro([
    { status: 400, body: { error: { code: 'json_validate_failed', message: 'Failed to validate JSON', failed_generation: '{"a":"cort' } } },
    ok('{"a":"completo"}')
  ]);
  const r = await completar({ sistema: 's', usuario: 'u', esquema });
  assert.equal(chamadas.length, 2, 'antes eram ate 3 chamadas (schema, json_object, texto)');
  assert.equal(chamadas[1].response_format, undefined, 'a segunda vai sem formato');
  assert.match(r.conteudo, /completo/);
});

test('acao interativa com limite estourado avisa na hora em vez de travar a tela', async () => {
  const chamadas = roteiro([
    { status: 429, retryAfter: '34', body: { error: { message: 'Rate limit reached on tokens per minute (TPM). Please try again in 34s.' } } },
    ok('nao deveria chegar aqui')
  ]);
  const inicio = Date.now();
  await assert.rejects(
    () => completar({ sistema: 's', usuario: 'u', interativo: true }),
    (err) => err.groqStatus === 429 && /limite de uso por minuto/i.test(mensagemAmigavel(err))
  );
  assert.equal(chamadas.length, 1);
  assert.ok(Date.now() - inicio < 2000, 'nao pode ficar esperando os 34s');
});

test('limite DIARIO: nao fica tentando de 40 em 40s e para de chamar ate liberar', async () => {
  const diario = {
    status: 429,
    body: { error: { message: 'Rate limit reached on tokens per day (TPD): Limit 200000, Used 196974, Requested 6781. Please try again in 27m2.16s.' } }
  };
  const chamadas = roteiro([diario, ok('nao deveria chegar aqui')]);
  const inicio = Date.now();
  await assert.rejects(
    () => completar({ sistema: 's', usuario: 'u', modelo: 'modelo-diario' }),
    (err) => err.esperaMs > 27 * 60_000 && /limite diario/i.test(mensagemAmigavel(err))
  );
  assert.equal(chamadas.length, 1, 'tarefa de fundo tambem desiste na hora');
  assert.ok(Date.now() - inicio < 2000);

  // proxima analise: nem chega a chamar a Groq (cada tentativa tambem conta no limite)
  await assert.rejects(() => completar({ sistema: 's', usuario: 'u', modelo: 'modelo-diario' }), (err) => err.groqStatus === 429);
  assert.equal(chamadas.length, 1);
});

test('conversa usa so as secoes da Skill que servem para responder', async () => {
  const { skillParaConversa } = await import('../server/services/ai/prompts.js');
  const skill = '# SKILL\n## 1. IDENTIDADE\nsou o Henrique\n# 8. ABERTURA PADRAO\noi\n# 23. OBJECAO: "MANDA O PRECO"\ndepende\n# 28. AUDIO\nroteiro';
  const conversa = skillParaConversa(skill);
  assert.match(conversa, /IDENTIDADE/);
  assert.match(conversa, /MANDA O PRECO/);
  assert.doesNotMatch(conversa, /ABERTURA PADRAO|AUDIO/);
});
