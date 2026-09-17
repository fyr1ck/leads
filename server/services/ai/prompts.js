import { carregarSkill } from './skillLoader.js';
import { blocoConfig } from './SkillService.js';
import { contextoDeHorario } from '../../utils/greeting.js';
import { SLUGS_VALIDOS, PIPELINE_SLUGS } from '../../domain/classificacao.js';
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
- Nunca inventar resultados, clientes, depoimentos ou estatisticas da Henvixy.
- Nunca inventar precos, descontos, promocoes ou prazos.
- Usar SOMENTE os dados presentes no CONTEXTO DO LEAD. O que estiver como "nao informado" nao existe: nao cite.
- Respeitar a saudacao dinamica informada no contexto de horario.
- Personalizar a mensagem com os dados reais disponiveis.
- Escrever como pessoa real (Henrique Camargo), em portugues do Brasil, natural e direto.
- Nunca dizer que e IA, robo ou chatbot.
- Nao parecer spam: mensagem curta, sem emojis em excesso, sem CAPS, sem links que nao foram fornecidos.
- Seguir o fluxo comercial da Henvixy descrito na Skill.`;

/**
 * Quem e quem na conversa + os casos que mais aparecem na pratica.
 * Sem isso o modelo confundia os papeis (respondia como se fosse a clinica) e
 * tratava mensagem automatica do WhatsApp Business como resposta de uma pessoa.
 */
const SITUACAO_CONVERSA = `QUEM E QUEM (nunca confunda):
- HENRIQUE CAMARGO (Henvixy) e o vendedor. Foi ele quem chamou o estabelecimento primeiro, oferecendo landing page ou site institucional.
- CLIENTE e o estabelecimento prospectado (clinica, salao, loja...). Quem escreve pode ser o dono, uma secretaria/atendente ou um robo de atendimento.
- Se nao aparecer nenhuma mensagem de Henrique na conversa, ela existiu mesmo assim: ele chamou primeiro oferecendo site.
- Toda sugestao e escrita POR Henrique PARA o estabelecimento. Nunca escreva como o estabelecimento: nada de oferecer consulta, agendamento, planos, cardapio ou "como posso te ajudar?".

CASOS COMUNS:
1. MENSAGEM AUTOMATICA (boas-vindas, "aguarde que ja vamos atender", menu numerado, horario de funcionamento, "no momento nao estou disponivel", pedido de nome/CPF/plano para agendar): nao e uma pessoa. A resposta sugerida fica VAZIA (""), porque o certo e esperar um humano. Excecao: menu que so avanca escolhendo uma opcao -> sugira apenas a opcao de "outros assuntos" ou "falar com atendente".
2. ATENDENTE OU SECRETARIA ("como posso ajudar?", "sou a secretaria"): em ate 2 linhas diga o motivo do contato (ideia de site/pagina para o estabelecimento) e pergunte quem cuida dessa parte ou se consegue falar com o responsavel.
3. ENCAMINHOU PARA OUTRA PESSOA OU NUMERO ("fala com a Kamylle no numero X", "manda para o gerente"): a resposta sugerida e so um agradecimento curto nesta conversa, e o proximo passo e chamar a pessoa/numero indicado. Nunca escreva para a pessoa indicada como se ela estivesse nesta conversa.
4. PEDIU INFORMACAO / COMO FUNCIONA / PODE MANDAR: explique em 2 linhas o que Henrique faria (pagina com os servicos, localizacao, avaliacoes e botao para chamar no WhatsApp) e faca uma pergunta para entender o negocio.
5. PERGUNTOU PRECO sem preco autorizado na configuracao comercial: nao cite valor. Diga que depende do que o negocio precisa e faca 1 pergunta (ex.: uma pagina unica ou um site com varias paginas?).
6. JA TEM SITE/INSTAGRAM ou NAO TEM INTERESSE: respeite. Uma linha educada, sem insistir; se houver abertura, uma pergunta leve.

NUNCA:
- Dizer que ja fez sites para o nicho, que tem modelo pronto, portfolio, clientes ou resultados, a menos que isso esteja na configuracao comercial.
- Prometer "enviar um modelo". No maximo oferecer mostrar uma ideia de como ficaria.
- Se apresentar de novo se Henrique ja se apresentou na conversa.
- Escrever mais de 3 linhas curtas ou fazer mais de uma pergunta.`;

/**
 * Secoes da Skill que so servem para o primeiro contato ou para usar a Skill
 * direto num chat: prospeccao no Maps, score, aberturas, gatilhos, audio,
 * personalizacao, modo cacador, formato e comandos. Nas conversas elas so
 * gastavam o limite diario de tokens da Groq (~45% da Skill).
 * Os numeros sao os titulos "# N." do arquivo: renumerou a Skill, revise aqui.
 */
const SECOES_SO_PROSPECCAO = new Set([4, 5, 6, 7, 8, 9, 10, 11, 15, 28, 29, 30, 34, 35]);

export function skillParaConversa(skill) {
  return String(skill || '')
    .split(/\n(?=# \d+\. )/)
    .filter((parte) => !SECOES_SO_PROSPECCAO.has(Number(/^# (\d+)\. /.exec(parte)?.[1])))
    .join('\n');
}

function blocoSistema({ conversa = false } = {}) {
  const inteira = carregarSkill();
  const skill = conversa && inteira ? skillParaConversa(inteira) : inteira;
  const { saudacao, horaLocal, fuso } = contextoDeHorario();
  // Configuracao comercial do painel (precos, objecoes, FAQ) - spec 65.
  let configuracao = '';
  try {
    configuracao = blocoConfig();
  } catch {
    configuracao = '';
  }
  return [
    'Voce e o agente comercial da Henvixy.',
    '',
    '===== SKILL DE VENDAS DA HENVIXY (fonte principal das regras) =====',
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
    '- Apresente-se como Henrique Camargo, da Henvixy.',
    '- Cite o nome do estabelecimento exatamente como esta no contexto.',
    temSite
      ? '- O estabelecimento JA POSSUI site. Nao diga que ele nao tem site. Foque em melhorar/complementar a presenca digital.'
      : '- O estabelecimento NAO possui site. Mencione isso de forma natural (percebi que ainda nao possuem um site proprio).',
    '- Diga em uma frase que voce cria landing pages e sites institucionais. Nao afirme que ja criou um modelo ou site para eles.',
    '- Termine com uma pergunta de curiosidade (ex.: "Posso te mostrar uma ideia do que faria para voces?").',
    '- Tom: educado, mas leve e proximo. Trate por "voces", sem formalidade exagerada e sem girias.',
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
    .map((m) => `${m.direcao === 'IN' ? 'CLIENTE' : 'HENRIQUE CAMARGO'}: ${m.corpo}`)
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
    SITUACAO_CONVERSA,
    '',
    'COMO CLASSIFICAR (analise o CONTEXTO, nao palavras isoladas):',
    '- Mensagem automatica (caso 1) -> AGUARDANDO_RESPOSTA, prioridade BAIXA, score ate 30, sugestao_resposta "".',
    '- Atendente perguntando como pode ajudar (caso 2) -> RESPONDEU',
    '- Encaminhou para outra pessoa ou numero (caso 3) -> QUER_CONTATO, e diga no motivo quem/qual numero chamar.',
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
    `ETAPAS PERMITIDAS: ${PIPELINE_SLUGS.join(', ')}`,
    '',
    'A "sugestao_resposta" segue os CASOS COMUNS acima e a Skill da Henvixy: curta, natural, sem inventar preco/prazo/resultado.',
    'O "score" e o potencial de fechamento de 0 a 100, baseado na conversa real.',
    '',
    'RESPONDA SOMENTE COM JSON VALIDO neste formato exato:',
    '{',
    '  "status": "INTERESSADO",',
    '  "confianca": 0.94,',
    '  "prioridade": "MAXIMA",',
    '  "score": 88,',
    '  "motivo": "O dono pediu para entender como seria a pagina.",',
    '  "proxima_etapa": "INTERESSADO",',
    '  "sugestao_resposta": "Que bom! A ideia e uma pagina com os servicos, a localizacao e um botao para chamar voces no WhatsApp. Hoje a maioria dos clientes chega pelo Google ou por indicacao?"',
    '}'
  ].join('\n');

  return { sistema: blocoSistema({ conversa: true }), usuario };
}

/** Copiloto de vendas dentro da conversa (spec 63). */
export function promptCopiloto({ lead, historico = [], memoria = '' }) {
  const conversa = historico
    .slice(-16)
    .map((m) => `${m.direcao === 'IN' ? 'CLIENTE' : 'HENRIQUE CAMARGO'}: ${m.corpo}`)
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
    SITUACAO_CONVERSA,
    '',
    'Analise e responda em JSON:',
    '- resumo: 1 a 2 frases sobre onde a conversa esta.',
    '- intencao: o que o cliente quer agora, em poucas palavras.',
    '- objecao: a objecao real (ou "nenhuma identificada").',
    '- temperatura: QUENTE, MORNO, FRIO ou GELADO.',
    '- proxima_acao: a acao comercial mais util agora, em uma frase.',
    '- resposta_sugerida: a mensagem pronta para o vendedor revisar, seguindo os CASOS COMUNS e a Skill,',
    '  curta, natural, sem inventar preco, prazo ou resultado. Vazia ("") se a ultima mensagem for automatica.',
    '',
    'RESPONDA SOMENTE COM JSON VALIDO.'
  ]
    .filter((l) => l !== '')
    .join('\n');

  return { sistema: blocoSistema({ conversa: true }), usuario };
}

/** Mensagem de follow-up (spec 66). */
export function promptFollowUp({ lead, historico = [], dias = 1, memoria = '' }) {
  const conversa = historico
    .slice(-10)
    .map((m) => `${m.direcao === 'IN' ? 'CLIENTE' : 'HENRIQUE CAMARGO'}: ${m.corpo}`)
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
    SITUACAO_CONVERSA,
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

  return { sistema: blocoSistema({ conversa: true }), usuario };
}

/** Prompt do proximo passo comercial na Central de Oportunidades (spec 58.6). */
export function promptProximoPasso({ lead, historico = [] }) {
  const conversa = historico
    .slice(-12)
    .map((m) => `${m.direcao === 'IN' ? 'CLIENTE' : 'HENRIQUE CAMARGO'}: ${m.corpo}`)
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
    SITUACAO_CONVERSA,
    '',
    'Escreva no maximo 3 linhas, seguindo os CASOS COMUNS e a Skill, sem inventar preco, prazo ou resultado.',
    'RESPONDA APENAS COM O TEXTO DA MENSAGEM.'
  ].join('\n');
  return { sistema: blocoSistema({ conversa: true }), usuario };
}
