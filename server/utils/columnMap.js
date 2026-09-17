/**
 * Mapeamento automatico das colunas da planilha (spec 6).
 * Tres camadas:
 *  1) apelido exato do cabecalho (tolerante a acento, caixa, espaco e pontuacao);
 *  2) cabecalho composto ("URL Google Maps", "Categoria Maps") - vale o apelido
 *     mais longo, e o conteudo da coluna precisa combinar com o campo;
 *  3) farejador de valores para colunas com nome esquisito ("link", "col3").
 * Nenhuma coluna e obrigatoria - o que nao existir simplesmente nao e usado.
 */

/** Campos principais: aparecem no aviso "nao encontrei coluna para...". */
export const CAMPOS = [
  'nome_estabelecimento',
  'telefone',
  'google_maps',
  'endereco',
  'cidade',
  'instagram',
  'categoria',
  'site',
  'observacoes'
];

/** Campos que so sao usados quando a planilha traz (listas do Google Maps). */
export const CAMPOS_OPCIONAIS = ['nicho', 'estado', 'avaliacao', 'total_avaliacoes', 'status_site'];

const APELIDOS = {
  nome_estabelecimento: [
    'nome', 'nomeestabelecimento', 'estabelecimento', 'empresa', 'nomeempresa', 'nomefantasia',
    'razaosocial', 'negocio', 'local', 'titulo', 'name', 'title', 'businessname', 'nomedolocal',
    'nomedoestabelecimento', 'nomedaempresa', 'loja', 'cliente'
  ],
  telefone: [
    'telefone', 'telefone1', 'telefones', 'whatsapp', 'whats', 'zap', 'celular', 'fone', 'tel',
    'contato', 'numero', 'numerotelefone', 'phone', 'phonenumber', 'mobile', 'telefonewhatsapp'
  ],
  google_maps: [
    'googlemaps', 'google', 'maps', 'linkgoogle', 'linkgooglemaps', 'linkdogoogle', 'linkdomaps',
    'linkmaps', 'urlmaps', 'mapsurl', 'googleurl', 'mapa', 'linkmapa', 'localizacao', 'urlgoogle',
    'googlemapslink', 'linkdogooglemaps', 'urlgooglemaps'
  ],
  endereco: ['endereco', 'enderecocompleto', 'rua', 'logradouro', 'address', 'localizacaoendereco', 'end'],
  cidade: ['cidade', 'municipio', 'city', 'localidade', 'cidadeestado', 'cidadeuf'],
  instagram: ['instagram', 'insta', 'ig', 'perfilinstagram', 'linkinstagram', 'instagramurl', 'arroba'],
  categoria: ['categoria', 'tipo', 'ramo', 'category', 'tipodenegocio', 'atividade', 'setor', 'categoriamaps'],
  site: ['site', 'website', 'url', 'pagina', 'paginaweb', 'web', 'dominio', 'homepage', 'siteurl', 'sitedaempresa'],
  observacoes: ['observacoes', 'observacao', 'obs', 'notas', 'anotacoes', 'comentarios', 'descricao', 'notes'],
  nicho: ['nicho', 'segmento', 'nichodemercado'],
  estado: ['uf', 'estado', 'siglauf', 'state'],
  avaliacao: ['avaliacao', 'nota', 'rating', 'notamedia', 'notagoogle', 'estrelas'],
  total_avaliacoes: [
    'qtdavaliacoes', 'quantidadeavaliacoes', 'quantidadedeavaliacoes', 'totalavaliacoes', 'numeroavaliacoes',
    'numerodeavaliacoes', 'avaliacoes', 'reviews', 'totalreviews', 'qtdreviews'
  ],
  status_site: [
    'statussite', 'statusdosite', 'temsite', 'possuisite', 'siteexibidonomaps', 'situacaodosite', 'sitenomaps'
  ]
};

export function normalizarCabecalho(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** So o apelido exato. */
function campoExato(cabecalho) {
  const alvo = normalizarCabecalho(cabecalho);
  if (!alvo) return null;
  for (const [campo, apelidos] of Object.entries(APELIDOS)) {
    if (apelidos.includes(alvo)) return campo;
  }
  return null;
}

/**
 * Cabecalho composto: vence o apelido MAIS LONGO contido no nome.
 * "Categoria Maps" -> categoria (9 letras) e nao google_maps ("maps", 4).
 */
function campoComposto(cabecalho) {
  const alvo = normalizarCabecalho(cabecalho);
  if (!alvo) return null;
  let melhor = null;
  let tamanho = 0;
  for (const [campo, apelidos] of Object.entries(APELIDOS)) {
    for (const a of apelidos) {
      if (a.length >= 4 && a.length > tamanho && alvo.includes(a)) {
        melhor = campo;
        tamanho = a.length;
      }
    }
  }
  return melhor;
}

/** Casa um cabecalho com um campo do sistema. Retorna null quando nao reconhece. */
export function campoDoCabecalho(cabecalho) {
  return campoExato(cabecalho) || campoComposto(cabecalho);
}

const SIM_NAO = /^(sim|nao|não|yes|no|true|false|verdadeiro|falso|s|n|x|-|com site|sem site|tem site|nao tem|não tem|possui|nao possui|não possui)$/i;

/** O conteudo da coluna combina com o campo? Evita "Site exibido: Nao" virar site. */
const CONTEUDO_COMBINA = {
  telefone: (v) => v.replace(/\D/g, '').length >= 8,
  google_maps: (v) => /google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google|google\.com\/\?cid=/i.test(v),
  site: (v) => !SIM_NAO.test(v) && (/^(https?:\/\/|www\.)/i.test(v) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)),
  instagram: (v) => /instagram\.com/i.test(v) || /^@?[\w.]{2,30}$/.test(v),
  avaliacao: (v) => /^\d([.,]\d+)?$/.test(v),
  total_avaliacoes: (v) => /^\d[\d.]*$/.test(v)
};

function conteudoCombina(campo, valores = []) {
  const teste = CONTEUDO_COMBINA[campo];
  if (!teste) return true;
  const amostra = valores.map((v) => String(v ?? '').trim()).filter(Boolean).slice(0, 25);
  if (!amostra.length) return true; // coluna vazia: nada para contrariar o cabecalho
  return amostra.filter(teste).length / amostra.length >= 0.5;
}

const PADROES_VALOR = [
  { campo: 'google_maps', teste: (v) => /google\.[a-z.]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google/i.test(v) },
  { campo: 'instagram', teste: (v) => /instagram\.com|^@[\w.]+$/i.test(v) },
  { campo: 'telefone', teste: (v) => /^\+?[\d\s().-]{8,20}$/.test(v) && (v.replace(/\D/g, '').length >= 10) },
  { campo: 'site', teste: (v) => /^https?:\/\//i.test(v) || /^www\./i.test(v) }
];

/**
 * Tenta descobrir o campo olhando os proprios valores da coluna.
 * Usado apenas para colunas cujo cabecalho nao foi reconhecido.
 */
export function campoPorValores(valores = []) {
  const amostra = valores.map((v) => String(v ?? '').trim()).filter(Boolean).slice(0, 25);
  if (amostra.length < 2) return null;
  for (const { campo, teste } of PADROES_VALOR) {
    const acertos = amostra.filter((v) => teste(v)).length;
    if (acertos / amostra.length >= 0.6) return campo;
  }
  return null;
}

/**
 * Monta o mapa coluna -> campo.
 * @param {string[]} cabecalhos
 * @param {Array<string[]>} amostras  valores por coluna (mesma ordem dos cabecalhos)
 */
export function mapearColunas(cabecalhos, amostras = []) {
  const mapa = {};
  const usados = new Set();
  const usar = (i, campo) => {
    if (!campo || mapa[i] || usados.has(campo)) return;
    if (!conteudoCombina(campo, amostras[i])) {
      // "Site: Nao" / "Tem site: Sim" -> e o status do site, nao o endereco dele
      if (campo === 'site' && !usados.has('status_site')) {
        const valores = (amostras[i] || []).map((v) => String(v ?? '').trim()).filter(Boolean);
        if (valores.length && valores.every((v) => SIM_NAO.test(v))) {
          mapa[i] = 'status_site';
          usados.add('status_site');
        }
      }
      return;
    }
    mapa[i] = campo;
    usados.add(campo);
  };

  // exatos primeiro em TODAS as colunas: "Nome" nunca perde para "Nome da cidade"
  cabecalhos.forEach((cab, i) => usar(i, campoExato(cab)));
  cabecalhos.forEach((cab, i) => usar(i, campoComposto(cab)));
  cabecalhos.forEach((cab, i) => usar(i, campoPorValores(amostras[i] || [])));

  return mapa;
}

/** "Nao", "Sem site" -> SEM_SITE; "Sim", "Com site", um link -> COM_SITE. */
export function statusSiteDoValor(valor) {
  const v = normalizarCabecalho(valor);
  if (!v) return null;
  if (/^(nao|n|no|false|falso|semsite|naotem|naopossui|nenhum|0)/.test(v)) return 'SEM_SITE';
  if (/^(sim|s|yes|true|verdadeiro|comsite|tem|possui|1|http|www)/.test(v)) return 'COM_SITE';
  if (/verificar|duvida|incerto/.test(v)) return 'VERIFICAR';
  return null;
}

/** "4,9" -> 4.9 ; "1.234" avaliacoes -> 1234. Valor estranho vira null (nada inventado). */
export function numeroDaPlanilha(valor, { inteiro = false } = {}) {
  const t = String(valor ?? '').trim();
  if (!t) return null;
  const n = inteiro ? Number(t.replace(/[.\s]/g, '')) : Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
