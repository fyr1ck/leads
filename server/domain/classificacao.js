/**
 * Catalogo unico de etiquetas, prioridades e pipeline (spec 17 / 18 / 58).
 * Backend e frontend usam a MESMA fonte: o frontend consome via GET /api/tags.
 */

export const PRIORIDADES = {
  MAXIMA: { rank: 4, nome: 'Prioridade maxima', emoji: '\u{1F525}', cor: '#f97316' },
  ALTA: { rank: 3, nome: 'Prioridade alta', emoji: '\u{1F7E0}', cor: '#fb923c' },
  MEDIA: { rank: 2, nome: 'Prioridade media', emoji: '\u{1F7E1}', cor: '#facc15' },
  BAIXA: { rank: 1, nome: 'Prioridade baixa', emoji: '\u{1F534}', cor: '#ef4444' }
};

export const rankPrioridade = (p) => PRIORIDADES[p]?.rank ?? 0;

/** Etapas do pipeline visual / Kanban (spec 58.12). */
export const PIPELINE = [
  { slug: 'NOVOS', nome: 'Novos' },
  { slug: 'RESPONDERAM', nome: 'Responderam' },
  { slug: 'INTERESSADOS', nome: 'Interessados' },
  { slug: 'DEMONSTRACAO', nome: 'Demonstracao' },
  { slug: 'NEGOCIACAO', nome: 'Negociacao' },
  { slug: 'FECHAMENTO', nome: 'Fechamento' },
  { slug: 'CLIENTE', nome: 'Cliente' }
];
export const PIPELINE_SLUGS = PIPELINE.map((p) => p.slug);

/** Status internos do lead (ciclo operacional, nao e etiqueta comercial). */
export const STATUS_LEAD = ['NOVO', 'NA_FILA', 'CONTATADO', 'RESPONDEU', 'FECHADO', 'ERRO', 'DESCARTADO'];

/**
 * Etiquetas padrao do sistema. `slug` e o valor que a IA pode retornar.
 * score = potencial da oportunidade (spec 58.7) usado como base quando a IA
 * nao devolve um numero proprio.
 */
export const TAGS_PADRAO = [
  { slug: 'INTERESSADO',         nome: 'Interessado',          emoji: '\u{1F7E2}', cor: '#22c55e', prioridade: 'MAXIMA', score: 85, pipeline: 'INTERESSADOS', ordem: 1 },
  { slug: 'PEDIU_DEMONSTRACAO',  nome: 'Pediu demonstracao',   emoji: '\u{1F7E0}', cor: '#f97316', prioridade: 'MAXIMA', score: 88, pipeline: 'DEMONSTRACAO', ordem: 2 },
  { slug: 'QUER_SABER_PRECO',    nome: 'Quer saber preco',     emoji: '\u{1F4B0}', cor: '#eab308', prioridade: 'MAXIMA', score: 90, pipeline: 'NEGOCIACAO',   ordem: 3 },
  { slug: 'NEGOCIANDO',          nome: 'Negociando',           emoji: '\u{1F7E3}', cor: '#a855f7', prioridade: 'MAXIMA', score: 93, pipeline: 'NEGOCIACAO',   ordem: 4 },
  { slug: 'QUER_CONTRATAR',      nome: 'Quer contratar',       emoji: '\u{1F91D}', cor: '#14b8a6', prioridade: 'MAXIMA', score: 97, pipeline: 'FECHAMENTO',   ordem: 5 },
  { slug: 'PEDIU_INFORMACOES',   nome: 'Pediu informacoes',    emoji: '\u{2139}',  cor: '#38bdf8', prioridade: 'ALTA',   score: 70, pipeline: 'INTERESSADOS', ordem: 6 },
  { slug: 'QUER_CONTATO',        nome: 'Quer contato',         emoji: '\u{1F4DE}', cor: '#60a5fa', prioridade: 'ALTA',   score: 68, pipeline: 'RESPONDERAM',  ordem: 7 },
  { slug: 'FALAR_DEPOIS',        nome: 'Pediu para falar depois', emoji: '\u{1F552}', cor: '#818cf8', prioridade: 'ALTA', score: 62, pipeline: 'RESPONDERAM', ordem: 8 },
  { slug: 'RESPONDEU',           nome: 'Respondeu',            emoji: '\u{1F535}', cor: '#3b82f6', prioridade: 'ALTA',   score: 55, pipeline: 'RESPONDERAM',  ordem: 9 },
  { slug: 'AGUARDANDO_RESPOSTA', nome: 'Aguardando resposta',  emoji: '\u{1F7E1}', cor: '#facc15', prioridade: 'MEDIA',  score: 45, pipeline: 'RESPONDERAM',  ordem: 10 },
  { slug: 'REVISAR_MANUALMENTE', nome: 'Revisar manualmente',  emoji: '\u{26A0}',  cor: '#f59e0b', prioridade: 'MEDIA',  score: 40, pipeline: 'RESPONDERAM',  ordem: 11 },
  { slug: 'JA_POSSUI_SITE',      nome: 'Ja possui site',       emoji: '\u{1F310}', cor: '#94a3b8', prioridade: 'BAIXA',  score: 25, pipeline: 'RESPONDERAM',  ordem: 12 },
  { slug: 'NAO_INTERESSADO',     nome: 'Nao interessado',      emoji: '\u{1F534}', cor: '#ef4444', prioridade: 'BAIXA',  score: 10, pipeline: 'RESPONDERAM',  ordem: 13 },
  { slug: 'RECUSOU',             nome: 'Recusou',              emoji: '\u{274C}',  cor: '#dc2626', prioridade: 'BAIXA',  score: 5,  pipeline: 'RESPONDERAM',  ordem: 14 },
  { slug: 'SEM_RESPOSTA',        nome: 'Sem resposta',          emoji: '\u{26AB}',  cor: '#64748b', prioridade: 'BAIXA',  score: 15, pipeline: 'NOVOS',        ordem: 15 }
];

export const TAGS_POR_SLUG = Object.fromEntries(TAGS_PADRAO.map((t) => [t.slug, t]));
export const SLUGS_VALIDOS = TAGS_PADRAO.map((t) => t.slug);

/** Etiquetas consideradas "oportunidade quente" na Central (spec 58). */
export const SLUGS_QUENTES = ['INTERESSADO', 'PEDIU_DEMONSTRACAO', 'QUER_SABER_PRECO', 'NEGOCIANDO', 'QUER_CONTRATAR'];
export const SLUGS_ACOMPANHAMENTO = ['PEDIU_INFORMACOES', 'QUER_CONTATO', 'FALAR_DEPOIS', 'RESPONDEU'];
export const SLUGS_AGUARDANDO = ['AGUARDANDO_RESPOSTA', 'REVISAR_MANUALMENTE'];
export const SLUGS_FRIOS = ['NAO_INTERESSADO', 'RECUSOU', 'JA_POSSUI_SITE', 'SEM_RESPOSTA'];

/** Faixas de potencial (spec 58.7). */
export function faixaPotencial(score = 0) {
  const s = Number(score) || 0;
  if (s >= 81) return { faixa: 'MUITO_ALTO', nome: 'Muito alto', emoji: '\u{1F525}', cor: '#f97316' };
  if (s >= 61) return { faixa: 'ALTO', nome: 'Alto', emoji: '\u{1F7E0}', cor: '#fb923c' };
  if (s >= 31) return { faixa: 'MEDIO', nome: 'Medio', emoji: '\u{1F7E1}', cor: '#facc15' };
  return { faixa: 'BAIXO', nome: 'Baixo', emoji: '\u{1F535}', cor: '#64748b' };
}

/** Normaliza o que a IA devolveu para um slug conhecido (nunca confia cegamente). */
export function normalizarEtiqueta(valor) {
  if (!valor) return null;
  const alvo = String(valor)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (TAGS_POR_SLUG[alvo]) return alvo;
  const apelidos = {
    QUER_PRECO: 'QUER_SABER_PRECO',
    PRECO: 'QUER_SABER_PRECO',
    ORCAMENTO: 'QUER_SABER_PRECO',
    DEMONSTRACAO: 'PEDIU_DEMONSTRACAO',
    PEDIU_MODELO: 'PEDIU_DEMONSTRACAO',
    QUER_VER: 'PEDIU_DEMONSTRACAO',
    INTERESSE: 'INTERESSADO',
    POSITIVO: 'INTERESSADO',
    COMO_FUNCIONA: 'INTERESSADO',
    MAIS_INFORMACOES: 'PEDIU_INFORMACOES',
    INFORMACOES: 'PEDIU_INFORMACOES',
    DEPOIS: 'FALAR_DEPOIS',
    CHAMAR_DEPOIS: 'FALAR_DEPOIS',
    VOU_PENSAR: 'AGUARDANDO_RESPOSTA',
    AMBIGUO: 'REVISAR_MANUALMENTE',
    NEUTRO: 'REVISAR_MANUALMENTE',
    TEM_SITE: 'JA_POSSUI_SITE',
    POSSUI_SITE: 'JA_POSSUI_SITE',
    SEM_INTERESSE: 'NAO_INTERESSADO',
    NEGATIVO: 'NAO_INTERESSADO',
    FECHADO: 'QUER_CONTRATAR',
    QUER_NEGOCIAR: 'NEGOCIANDO'
  };
  return apelidos[alvo] || null;
}

/** Grupo da Central de Oportunidades a partir da etiqueta. */
export function grupoOportunidade(slug) {
  if (SLUGS_QUENTES.includes(slug)) return 'QUENTE';
  if (SLUGS_ACOMPANHAMENTO.includes(slug)) return 'ACOMPANHAMENTO';
  if (SLUGS_AGUARDANDO.includes(slug)) return 'AGUARDANDO';
  if (SLUGS_FRIOS.includes(slug)) return 'FRIO';
  return 'ACOMPANHAMENTO';
}
