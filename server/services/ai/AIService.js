import { completar, verificarConexao } from './GroqClient.js';
import {
  promptPrimeiraMensagem,
  promptAnaliseResposta,
  promptProximoPasso,
  promptCopiloto,
  promptFollowUp
} from './prompts.js';
import { montarMemoria } from './memoria.js';
import { carregarSkill, infoSkill } from './skillLoader.js';
import { config, hasGroqKey } from '../../config.js';
import { saudacaoDinamica } from '../../utils/greeting.js';
import { logger } from '../../utils/logger.js';
import {
  normalizarEtiqueta,
  TAGS_POR_SLUG,
  PRIORIDADES,
  PIPELINE_SLUGS,
  SLUGS_VALIDOS,
  faixaPotencial
} from '../../domain/classificacao.js';

/**
 * Formato exigido da analise (spec 16). Com structured output a Groq obriga o
 * modelo a devolver exatamente isso - sem texto solto em volta do JSON.
 */
const ESQUEMA_ANALISE = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: SLUGS_VALIDOS },
    confianca: { type: 'number' },
    prioridade: { type: 'string', enum: Object.keys(PRIORIDADES) },
    score: { type: 'integer' },
    motivo: { type: 'string' },
    proxima_etapa: { type: 'string', enum: PIPELINE_SLUGS },
    sugestao_resposta: { type: 'string' }
  },
  required: ['status', 'confianca', 'prioridade', 'score', 'motivo', 'proxima_etapa', 'sugestao_resposta'],
  additionalProperties: false
};

/** Formato do copiloto de vendas (spec 63). */
const ESQUEMA_COPILOTO = {
  type: 'object',
  properties: {
    resumo: { type: 'string' },
    intencao: { type: 'string' },
    objecao: { type: 'string' },
    temperatura: { type: 'string', enum: ['QUENTE', 'MORNO', 'FRIO', 'GELADO'] },
    proxima_acao: { type: 'string' },
    resposta_sugerida: { type: 'string' }
  },
  required: ['resumo', 'intencao', 'objecao', 'temperatura', 'proxima_acao', 'resposta_sugerida'],
  additionalProperties: false
};

const vazio = (v) => v === null || v === undefined || String(v).trim() === '';

/**
 * Limpeza do texto gerado: tira markdown, aspas, placeholders esquecidos e
 * links que ninguem autorizou (spec 52 - nao inventar dados).
 */
export function limparMensagem(texto, { permitirLinks = false } = {}) {
  let t = String(texto || '').trim();
  t = t.replace(/^```[a-z]*\n?|```$/g, '').trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) t = t.slice(1, -1).trim();
  t = t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|\s)\*(\S[^*]*?)\*/g, '$1$2');
  t = t.replace(/^\s*(mensagem|resposta)\s*:\s*/i, '');
  if (!permitirLinks) t = t.replace(/https?:\/\/\S+/g, '').replace(/[ \t]{2,}/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  return t.slice(0, 900);
}

/** Sobrou placeholder ([NOME], {{CIDADE}})? Entao a mensagem nao presta. */
const temPlaceholder = (t) => /\{\{.*?\}\}|\[[A-ZÀ-Ú_ ]{3,}\]/.test(t);

/**
 * Mensagem de reserva: usada quando a Groq esta indisponivel.
 * NAO e uma estrategia nova - e literalmente a ABORDAGEM PADRAO da Skill,
 * montada apenas com dados reais do lead (spec 2 / 22 / 52).
 */
export function mensagemPadraoDaSkill(lead) {
  const saudacao = saudacaoDinamica();
  const nome = String(lead.nome_estabelecimento || '').trim();
  const cidade = vazio(lead.cidade) ? '' : ` de ${String(lead.cidade).trim()}`;
  const temSite = !vazio(lead.site);
  const linhas = [
    `${saudacao}! Tudo bem?`,
    '',
    'Aqui é o Henrique Camargo, da Henvixy.',
    '',
    `Estava analisando alguns estabelecimentos${cidade} e encontrei a ${nome}.`,
    '',
    temSite
      ? 'Achei o trabalho de vocês interessante e dei uma olhada na página de vocês.'
      : 'Achei o trabalho de vocês interessante e percebi que vocês ainda não possuem um site próprio.',
    '',
    'Eu crio landing pages e sites institucionais para negócios como o de vocês.',
    '',
    'Posso te mostrar uma ideia do que faria para vocês?'
  ];
  return linhas.join('\n');
}

/**
 * Classificador local de emergencia (Groq fora do ar).
 * Cobre os exemplos da spec 18 e marca origem HEURISTICA para o operador saber.
 */
export function classificarHeuristico(texto) {
  const t = String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  const tem = (...termos) => termos.some((x) => t.includes(x));
  // palavra inteira: "pode" nao pode casar com "podemos"
  const palavra = (...termos) => termos.some((x) => new RegExp(`\\b${x}\\b`).test(t));

  // Robo do WhatsApp Business (boas-vindas, menu, horario): ninguem respondeu ainda.
  if (tem('seja bem vindo', 'seja bem-vindo', 'aguarde', 'horario de funcionamento', 'nao estou disponivel', 'respondemos por ordem', 'digite o numero', 'escolha uma opcao'))
    return { status: 'AGUARDANDO_RESPOSTA', score: 30, confianca: 0.5 };
  if (tem('como podemos ajudar', 'como posso ajudar', 'em que posso ajudar'))
    return { status: 'RESPONDEU', score: 50, confianca: 0.5 };

  if (tem('nao tenho interesse', 'sem interesse', 'nao quero', 'nao me interessa', 'para de mandar', 'nao precisa'))
    return { status: 'NAO_INTERESSADO', score: 10, confianca: 0.6 };

  const falaDeSite = tem('ja temos site', 'ja tenho site', 'ja possuimos', 'temos site', 'tenho site', 'ja tem site');
  const insatisfeito = tem('antigo', 'velho', 'desatualizado', 'parado', 'abandonado', 'ruim', 'precisa atualizar', 'precisa mexer', 'nao mexo', 'nunca atualizei');
  // "Ja tenho site, mas esta bem antigo" continua sendo oportunidade (spec 58.8).
  if (falaDeSite && insatisfeito) return { status: 'PEDIU_INFORMACOES', score: 68, confianca: 0.55 };

  if (tem('quanto custa', 'quanto fica', 'qual o valor', 'qual valor', 'preco', 'orcamento', 'quanto e'))
    return { status: 'QUER_SABER_PRECO', score: 85, confianca: 0.65 };
  // Sinal de tempo vem antes de "pode mandar": "sem tempo, mas pode mandar" e acompanhamento.
  if (tem('vou pensar', 'depois eu vejo', 'vejo depois', 'me chama amanha', 'me chama depois', 'fala comigo depois', 'agora nao', 'sem tempo', 'mais tarde', 'semana que vem'))
    return { status: 'FALAR_DEPOIS', score: 58, confianca: 0.55 };
  if (tem('pode mandar', 'pode enviar', 'manda ai', 'quero ver', 'gostaria de ver', 'me manda', 'pode me mandar'))
    return { status: 'PEDIU_DEMONSTRACAO', score: 82, confianca: 0.65 };
  if (tem('como funciona', 'me explica', 'mais informacoes', 'mais detalhes', 'como seria'))
    return { status: 'INTERESSADO', score: 72, confianca: 0.6 };
  if (falaDeSite) return { status: 'JA_POSSUI_SITE', score: 30, confianca: 0.55 };
  if (tem('me liga', 'pode ligar', 'meu contato', 'fala com', 'whatsapp do'))
    return { status: 'QUER_CONTATO', score: 65, confianca: 0.5 };
  if (palavra('sim', 'claro', 'pode', 'quero', 'bora', 'vamos'))
    return { status: 'INTERESSADO', score: 70, confianca: 0.45 };
  return { status: 'REVISAR_MANUALMENTE', score: 40, confianca: 0.3 };
}

function extrairJson(texto) {
  const t = String(texto || '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const inicio = t.indexOf('{');
    const fim = t.lastIndexOf('}');
    if (inicio >= 0 && fim > inicio) {
      try {
        return JSON.parse(t.slice(inicio, fim + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizarAnalise(bruto, { texto, origem }) {
  const etiqueta =
    normalizarEtiqueta(bruto?.status || bruto?.etiqueta) || classificarHeuristico(texto).status;
  const tag = TAGS_POR_SLUG[etiqueta];

  const prioridade = PRIORIDADES[String(bruto?.prioridade || '').toUpperCase()]
    ? String(bruto.prioridade).toUpperCase()
    : tag?.prioridade || 'MEDIA';

  let score = Number(bruto?.score);
  if (!Number.isFinite(score)) score = tag?.score ?? 40;
  score = Math.max(0, Math.min(100, Math.round(score)));

  let confianca = Number(bruto?.confianca);
  if (!Number.isFinite(confianca)) confianca = 0.4;
  if (confianca > 1) confianca = confianca / 100;
  confianca = Math.max(0, Math.min(1, Number(confianca.toFixed(2))));

  const etapa = String(bruto?.proxima_etapa || '').toUpperCase();
  const proxima_etapa = PIPELINE_SLUGS.includes(etapa) ? etapa : tag?.pipeline || 'RESPONDERAM';

  return {
    etiqueta,
    prioridade,
    score,
    confianca,
    motivo: String(bruto?.motivo || '').slice(0, 500) || 'Classificacao automatica da resposta.',
    // A sugestao NUNCA e enviada: ela existe so para o operador ver (spec 15 / 29 / 50).
    sugestao_resposta: limparMensagem(bruto?.sugestao_resposta || '', { permitirLinks: true }) || null,
    proxima_etapa,
    origem
  };
}

export const AIService = {
  disponivel: () => hasGroqKey(),

  async status() {
    const skill = infoSkill();
    const groq = hasGroqKey()
      ? await verificarConexao()
      : { conectado: false, modelo: config.groq.model, motivo: 'GROQ_API_KEY nao configurada' };
    return {
      groq: { ...groq, configurado: hasGroqKey() },
      skill,
      analiseAutomatica: config.ia.analiseAutomatica,
      // Sempre false. Nao existe rota que envie resposta sozinha (spec 28 / 50).
      respostaAutomatica: false
    };
  },

  /** Gera a primeira mensagem de prospeccao (spec 22). */
  async gerarPrimeiraMensagem(lead) {
    const padrao = mensagemPadraoDaSkill(lead);
    if (!hasGroqKey() || !carregarSkill()) {
      return { mensagem: padrao, origem: 'SKILL_PADRAO', modelo: null };
    }
    try {
      const { sistema, usuario } = promptPrimeiraMensagem(lead);
      const { conteudo, modelo } = await completar({ sistema, usuario, maxTokens: 600 });
      const limpa = limparMensagem(conteudo, { permitirLinks: Boolean(config.operacao.linkDemonstracao) });
      if (!limpa || limpa.length < 40 || temPlaceholder(limpa)) {
        logger.warn('ia', 'Mensagem gerada invalida. Usando a abordagem padrao da Skill.');
        return { mensagem: padrao, origem: 'SKILL_PADRAO', modelo };
      }
      return { mensagem: limpa, origem: 'GROQ', modelo };
    } catch (err) {
      logger.warn('ia', `Falha ao gerar mensagem (${err.message}). Usando abordagem padrao da Skill.`);
      return { mensagem: padrao, origem: 'SKILL_PADRAO', modelo: null, erro: err.message };
    }
  },

  /**
   * Analisa a resposta recebida e devolve classificacao estruturada (spec 16).
   * Retorna sugestao de resposta, mas QUEM ENVIA E O OPERADOR.
   */
  async analisarResposta({ lead, mensagem, historico = [] }) {
    if (!hasGroqKey()) {
      const h = classificarHeuristico(mensagem);
      return normalizarAnalise(
        { ...h, motivo: 'Groq nao configurada: classificacao local por palavras-chave.' },
        { texto: mensagem, origem: 'HEURISTICA' }
      );
    }
    try {
      const { sistema, usuario } = promptAnaliseResposta({ lead, mensagem, historico });
      const { conteudo, modelo } = await completar({
        sistema,
        usuario,
        esquema: ESQUEMA_ANALISE,
        temperatura: 0.2,
        maxTokens: 800,
        modelo: config.groq.modelAnalise
      });
      const bruto = extrairJson(conteudo);
      if (!bruto) throw new Error('A IA nao devolveu JSON valido.');
      return { ...normalizarAnalise(bruto, { texto: mensagem, origem: 'GROQ' }), modelo, bruto };
    } catch (err) {
      logger.warn('ia', `Analise via Groq falhou (${err.message}). Classificando localmente.`);
      const h = classificarHeuristico(mensagem);
      return normalizarAnalise(
        { ...h, motivo: `IA indisponivel (${err.message}). Classificacao local por palavras-chave.` },
        { texto: mensagem, origem: 'HEURISTICA' }
      );
    }
  },

  /**
   * COPILOTO DE VENDAS (spec 63).
   * Le a conversa + a memoria do lead e devolve resumo, intencao, objecao,
   * temperatura, proxima acao e uma resposta pronta para o operador revisar.
   * Nada e enviado por aqui - o envio exige acao explicita da pessoa.
   */
  async copiloto({ lead, historico = [] }) {
    const { texto: memoria } = montarMemoria(lead.id);

    if (!hasGroqKey()) {
      const h = classificarHeuristico(historico.filter((m) => m.direcao === 'IN').at(-1)?.corpo || '');
      const tag = TAGS_POR_SLUG[h.status];
      return {
        resumo: 'Groq nao configurada: analise local por palavras-chave.',
        intencao: tag?.nome || 'nao identificada',
        objecao: 'nao identificada',
        temperatura: faixaPotencial(lead.score).faixa,
        proxima_acao: 'Revisar a conversa manualmente e responder.',
        resposta_sugerida: null,
        origem: 'HEURISTICA',
        enviadoAutomaticamente: false
      };
    }

    const { sistema, usuario } = promptCopiloto({ lead, historico, memoria });
    const { conteudo, modelo } = await completar({
      sistema,
      usuario,
      esquema: ESQUEMA_COPILOTO,
      temperatura: 0.3,
      maxTokens: 900,
      modelo: config.groq.modelAnalise,
      // a pessoa esta olhando: se o limite por minuto estiver cheio, avisa o
      // tempo em vez de deixar o botao girando por minutos
      interativo: true
    });
    const bruto = extrairJson(conteudo) || {};

    return {
      resumo: String(bruto.resumo || '').slice(0, 400) || 'Sem resumo.',
      intencao: String(bruto.intencao || 'nao identificada').slice(0, 160),
      objecao: String(bruto.objecao || 'nenhuma identificada').slice(0, 200),
      temperatura: ['QUENTE', 'MORNO', 'FRIO', 'GELADO'].includes(String(bruto.temperatura || '').toUpperCase())
        ? String(bruto.temperatura).toUpperCase()
        : faixaPotencial(lead.score).faixa,
      proxima_acao: String(bruto.proxima_acao || '').slice(0, 220) || 'Responder o cliente.',
      resposta_sugerida: limparMensagem(bruto.resposta_sugerida || '', { permitirLinks: true }) || null,
      origem: 'GROQ',
      modelo,
      // Deixa explicito para o painel: continua sendo o operador quem envia.
      enviadoAutomaticamente: false
    };
  },

  /** Mensagem de follow-up para o operador revisar (spec 66). */
  async gerarFollowUp({ lead, historico = [], diasSemResposta = 1 }) {
    const { texto: memoria } = montarMemoria(lead.id);

    if (!hasGroqKey()) {
      const saudacao = saudacaoDinamica();
      return {
        mensagem: `${saudacao}! Passando para saber se faz sentido eu te mostrar a ideia de página que pensei para a ${lead.nome_estabelecimento}.\n\nSe quiser, posso te explicar rapidinho como ficaria. Faz sentido para vocês?`,
        origem: 'SKILL_PADRAO'
      };
    }

    try {
      const { sistema, usuario } = promptFollowUp({ lead, historico, dias: diasSemResposta, memoria });
      const { conteudo, modelo } = await completar({ sistema, usuario, maxTokens: 500 });
      const limpa = limparMensagem(conteudo, { permitirLinks: Boolean(config.operacao.linkDemonstracao) });
      if (!limpa || temPlaceholder(limpa)) throw new Error('Mensagem de follow-up invalida.');
      return { mensagem: limpa, origem: 'GROQ', modelo };
    } catch (err) {
      logger.warn('ia', `Follow-up via Groq falhou (${err.message}). Usando texto padrao.`);
      const saudacao = saudacaoDinamica();
      return {
        mensagem: `${saudacao}! Passando para saber se faz sentido eu te mostrar a ideia de página que pensei para a ${lead.nome_estabelecimento}.\n\nSe quiser, posso te explicar rapidinho como ficaria. Faz sentido para vocês?`,
        origem: 'SKILL_PADRAO'
      };
    }
  },

  /** Sugestao do proximo passo comercial para a Central de Oportunidades (spec 58.6). */
  async sugerirProximoPasso({ lead, historico = [] }) {
    if (!hasGroqKey()) {
      return { sugestao: null, origem: 'INDISPONIVEL', motivo: 'GROQ_API_KEY nao configurada.' };
    }
    const { sistema, usuario } = promptProximoPasso({ lead, historico });
    const { conteudo, modelo } = await completar({ sistema, usuario, maxTokens: 500, interativo: true });
    return { sugestao: limparMensagem(conteudo, { permitirLinks: true }), origem: 'GROQ', modelo };
  }
};

export default AIService;
