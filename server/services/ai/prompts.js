import { carregarSkill } from './skillLoader.js';
import { blocoConfig } from './SkillService.js';
import { contextoDeHorario } from '../../utils/greeting.js';
import { SLUGS_VALIDOS } from '../../domain/classificacao.js';
import { config } from '../../config.js';

const vazio = (v) => v === null || v === undefined || String(v).trim() === '';
const ou = (v, alt = 'nao informado') => (vazio(v) ? alt : String(v).trim());

/** Monta o bloco CONTEXTO DO LEAD apenas com dados reais (spec 21 / 52). */
export function contextoDoLead(lead = {}) {
  const linhas = [
    `Nome: ${ou(lead.nome_estabelecimento)}`,
    `Cidade: ${ou(lead.cidade)}`,
    `Categoria/Segmento: ${ou(lead.categoria)}`,
    `Google Maps: ${ou(lead.google_maps)}`,
    `Instagram: ${ou(lead.instagram)}`,
    `Site: ${ou(lead.site, 'NAO POSSUI SITE')}`,
    `Endereco: ${ou(lead.endereco)}`
  ];
  if (!vazio(lead.observacoes)) linhas.push(`Observacoes do operador: ${lead.observacoes}`);
  return linhas.join('\n');
}

const REGRAS_SISTEMA = `REGRAS DO SISTEMA (obrigatorias, acima de qualquer criatividade):
- Nunca inventar informacoes sobre o estabelecimento.
- Nunca inventar resultados, clientes, depoimentos ou estatisticas da Henvix.
- Nunca inventar precos, descontos, promocoes ou prazos.
- Usar SOMENTE os dados presentes no CONTEXTO DO LEAD. O que estiver como "nao informado" nao existe: nao cite.
- Respeitar a saudacao dinamica informada no contexto de horario.
- Personalizar a mensagem com os dados reais disponiveis.
- Escrever como pessoa real (Joao Henrique), em portugues do Brasil, natural e direto.
- Nunca dizer que e IA, robo ou chatbot.
- Nao parecer spam: mensagem curta, sem emojis em excesso, sem CAPS, sem links que nao foram fornecidos.
- Seguir o fluxo comercial da Henvix descrito na Skill.`;

function blocoSistema() {
  const skill = carregarSkill();
  const { saudacao, horaLocal, fuso } = contextoDeHorario();
  // Configuracao comercial do painel (precos, objecoes, FAQ) - spec 65.
  let configuracao = '';
  try {
    configuracao = blocoConfig();
  } catch {
    configuracao = '';
  }
  return [
    'Voce e o agente comercial da Henvix.',
    '',
    '===== SKILL DE VENDAS DA HENVIX (fonte principal das regras) =====',
    skill ||
      '[ATENCAO: arquivo da Skill nao encontrado. Nao invente estrategia comercial: use apenas a abordagem padrao informada pelo sistema.]',
    '===== FIM DA SKILL =====',
    configuracao ? `\n${configuracao}` : '',
    '',
    REGRAS_SISTEMA,
    '',
    `CONTEXTO DE HORARIO (ja calculado pelo sistema, use exatamente assim):`,
    `Horario atual: ${horaLocal} - ${fuso}`,
    `Saudacao correta agora: "${saudacao}!"`
  ].join('\n');
}

/** Prompt da primeira mensagem de prospeccao (spec 22). */
export function promptPrimeiraMensagem(lead) {
  const temSite = !vazio(lead.site);
  const linkDemo = config.operacao.linkDemonstracao;
  const instrucoes = [
    'TAREFA: escrever a PRIMEIRA mensagem de prospeccao no WhatsApp para este estabelecimento.',
    '',
    'CONTEXTO DO LEAD:',
    contextoDoLead(lead),
    '',
    'REQUISITOS DA MENSAGEM:',
    '- Comece com a saudacao correta do contexto de horario.',
    '- Apresente-se como Joao Henrique, da Henvix.',
    '- Cite o nome do estabelecimento exatamente como esta no contexto.',
    temSite
      ? '- O estabelecimento JA POSSUI site. Nao diga que ele nao tem site. Foque em melhorar/complementar a presenca digital.'
      : '- O estabelecimento NAO possui site. Mencione isso de forma natural (percebi que ainda nao possuem um site proprio).',
    '- Use a estrategia do modelo pronto da Skill e termine com uma pergunta de curiosidade (ex.: "Voces gostariam de ver como ficou?").',
    '- Objetivo e apenas GERAR CURIOSIDADE E CONSEGUIR RESPOSTA. Nao tente fechar venda agora.',
    linkDemo ? '' : '- NAO envie nenhum link nesta mensagem.',
    '- Maximo de 6 linhas curtas. Sem markdown, sem aspas em volta, sem assinatura.',
    '',
    'RESPONDA APENAS COM O TEXTO DA MENSAGEM, nada mais.'
  ].filter(Boolean);
  return { sistema: blocoSistema(), usuario: instrucoes.join('\n') };
}

/** Prompt de analise da resposta recebida (spec 16 / 18 / 58). */
export function promptAnaliseResposta({ lead, mensagem, historico = [] }) {
  const conversa = historico
    .slice(-10)
    .map((m) => `${m.direcao === 'IN' ? 'CLIENTE' : 'JOAO HENRIQUE'}: ${m.corpo}`)
    .join('\n');

  const usuario = [
    'TAREFA: analisar a resposta do estabelecimento e classificar a oportunidade.',
    'Voce NAO vai responder o cliente. Voce apenas analisa e prepara uma sugestao para o vendedor humano decidir.',
    '',
    'CONTEXTO DO LEAD:',
    contextoDoLead(lead),
    '',
    'CONVERSA ATE AQUI:',
    conversa || '(sem historico)',
    '',
    `ULTIMA MENSAGEM RECEBIDA DO CLIENTE:\n"${String(mensagem).slice(0, 1500)}"`,
    '',
    'COMO CLASSIFICAR (analise o CONTEXTO, nao palavras isoladas):',
    '- "Pode mandar" / "Quero ver" -> INTERESSADO ou PEDIU_DEMONSTRACAO',
    '- "Quanto custa?" -> QUER_SABER_PRECO',
    '- "Como funciona?" -> INTERESSADO',
    '- "Ja temos site" -> JA_POSSUI_SITE, MAS se ele demonstrar insatisfacao ou abertura (ex.: "esta antigo"), trate como oportunidade (INTERESSADO ou PEDIU_INFORMACOES) e explique no motivo.',
    '- "Vou pensar" / "Me chama amanha" / "agora nao tenho tempo, mas pode mandar" -> AGUARDANDO_RESPOSTA ou FALAR_DEPOIS (continua sendo oportunidade, nunca NAO_INTERESSADO).',
    '- "Obrigado, mas nao tenho interesse" -> NAO_INTERESSADO',
    '- Resposta ambigua ou impossivel de entender -> REVISAR_MANUALMENTE',
    '',
    `ETIQUETAS PERMITIDAS (use exatamente uma destas em "status"): ${SLUGS_VALIDOS.join(', ')}`,
    'PRIORIDADES PERMITIDAS: MAXIMA, ALTA, MEDIA, BAIXA',
    'ETAPAS PERMITIDAS: NOVOS, RESPONDERAM, INTERESSADOS, DEMONSTRACAO, NEGOCIACAO, FECHAMENTO, CLIENTE',
    '',
    'A "sugestao_resposta" deve seguir a Skill da Henvix, ser curta, natural, sem inventar preco/prazo/resultado.',
    'O "score" e o potencial de fechamento de 0 a 100, baseado na conversa real.',
    '',
    'RESPONDA SOMENTE COM JSON VALIDO neste formato exato:',
    '{',
    '  "status": "INTERESSADO",',
    '  "confianca": 0.94,',
    '  "prioridade": "MAXIMA",',
    '  "score": 88,',
    '  "motivo": "O estabelecimento pediu para visualizar o modelo.",',
    '  "proxima_etapa": "DEMONSTRACAO",',
    '  "sugestao_resposta": "Claro! Vou te enviar o modelo..."',
    '}'
  ].join('\n');

  return { sistema: blocoSistema(), usuario };
}

/** Copiloto de vendas dentro da conversa (spec 63). */
export function promptCopiloto({ lead, historico = [], memoria = '' }) {
  const conversa = historico
    .slice(-16)
    .map((m) => `${m.direcao === 'IN' ? 'CLIENTE' : 'JOAO HENRIQUE'}: ${m.corpo}`)
    .join('\n');

  const usuario = [
    'TAREFA: agir como copiloto do vendedor humano nesta conversa.',
    'Voce NAO envia nada. Tudo o que voce escrever aparece no painel para a pessoa decidir.',
    '',
    'CONTEXTO DO LEAD:',
    contextoDoLead(lead),
    '',
    memoria ? `MEMORIA DO RELACIONAMENTO (fatos ja registrados):\n${memoria}` : '',
    '',
    'CONVERSA:',
    conversa || '(sem mensagens ainda)',
    '',
    'Analise e responda em JSON:',
    '- resumo: 1 a 2 frases sobre onde a conversa esta.',
    '- intencao: o que o cliente quer agora, em poucas palavras.',
    '- objecao: a objecao real (ou "nenhuma identificada").',
    '- temperatura: QUENTE, MORNO, FRIO ou GELADO.',
    '- proxima_acao: a acao comercial mais util agora, em uma frase.',
    '- resposta_sugerida: a mensagem pronta para o vendedor revisar, seguindo a Skill,',
    '  curta, natural, sem inventar preco, prazo ou resultado.',
    '',
    'RESPONDA SOMENTE COM JSON VALIDO.'
  ]
    .filter((l) => l !== '')
    .join('\n');

  return { sistema: blocoSistema(), usuario };
}

/** Mensagem de follow-up (spec 66). */
export function promptFollowUp({ lead, historico = [], dias = 1, memoria = '' }) {
  const conversa = historico
    .slice(-10)
    .map((m) => `${m.direcao === 'IN' ? 'CLIENTE' : 'JOAO HENRIQUE'}: ${m.corpo}`)
    .join('\n');

  const usuario = [
    `TAREFA: escrever um follow-up ${dias} dia(s) depois do ultimo contato.`,
    'O cliente nao respondeu ou a conversa esfriou. Voce NAO envia: o vendedor revisa antes.',
    '',
    'CONTEXTO DO LEAD:',
    contextoDoLead(lead),
    '',
    memoria ? `MEMORIA DO RELACIONAMENTO:\n${memoria}` : '',
    '',
    'CONVERSA ATE AQUI:',
    conversa || '(apenas a abordagem inicial)',
    '',
    'REGRAS DO FOLLOW-UP:',
    '- Curto: no maximo 3 linhas.',
    '- Nao repetir a mensagem anterior com outras palavras.',
    '- Nao cobrar, nao pressionar, nao soar automatico.',
    '- Retomar pelo ponto onde a conversa parou (use a memoria acima).',
    '- Terminar com uma pergunta leve e facil de responder.',
    '- Nada de preco, prazo ou resultado inventado.',
    '',
    'RESPONDA APENAS COM O TEXTO DA MENSAGEM.'
  ]
    .filter((l) => l !== '')
    .join('\n');

  return { sistema: blocoSistema(), usuario };
}

/** Prompt do proximo passo comercial na Central de Oportunidades (spec 58.6). */
export function promptProximoPasso({ lead, historico = [] }) {
  const conversa = historico
    .slice(-12)
    .map((m) => `${m.direcao === 'IN' ? 'CLIENTE' : 'JOAO HENRIQUE'}: ${m.corpo}`)
    .join('\n');
  const usuario = [
    'TAREFA: sugerir a proxima mensagem que o vendedor humano poderia enviar.',
    'Voce NAO envia nada. A sugestao aparece no painel para o operador copiar, editar ou ignorar.',
    '',
    'CONTEXTO DO LEAD:',
    contextoDoLead(lead),
    '',
    'CONVERSA ATE AQUI:',
    conversa || '(sem historico)',
    '',
    `Etiqueta atual: ${lead.etiqueta || 'sem etiqueta'}`,
    '',
    'Escreva no maximo 4 linhas, seguindo a Skill, sem inventar preco, prazo ou resultado.',
    'RESPONDA APENAS COM O TEXTO DA MENSAGEM.'
  ].join('\n');
  return { sistema: blocoSistema(), usuario };
}
