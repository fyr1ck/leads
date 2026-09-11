/**
 * Mapeamento automatico das colunas da planilha (spec 6).
 * Duas camadas:
 *  1) apelidos de cabecalho (tolerante a acento, caixa, espaco e pontuacao);
 *  2) farejador de valores para colunas com nome esquisito ("link", "col3").
 * Nenhuma coluna e obrigatoria - o que nao existir simplesmente nao e usado.
 */

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
    'googlemapslink', 'linkdogooglemaps'
  ],
  endereco: ['endereco', 'enderecocompleto', 'rua', 'logradouro', 'address', 'localizacaoendereco', 'end'],
  cidade: ['cidade', 'municipio', 'city', 'localidade', 'cidadeestado', 'cidadeuf'],
  instagram: ['instagram', 'insta', 'ig', 'perfilinstagram', 'linkinstagram', 'instagramurl', 'arroba'],
  categoria: ['categoria', 'segmento', 'tipo', 'ramo', 'nicho', 'category', 'tipodenegocio', 'atividade', 'setor'],
  site: ['site', 'website', 'url', 'pagina', 'paginaweb', 'web', 'dominio', 'homepage', 'siteurl', 'sitedaempresa'],
  observacoes: ['observacoes', 'observacao', 'obs', 'notas', 'anotacoes', 'comentarios', 'descricao', 'notes']
};

export function normalizarCabecalho(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Casa um cabecalho com um campo do sistema. Retorna null quando nao reconhece. */
export function campoDoCabecalho(cabecalho) {
  const alvo = normalizarCabecalho(cabecalho);
  if (!alvo) return null;
  for (const [campo, apelidos] of Object.entries(APELIDOS)) {
    if (apelidos.includes(alvo)) return campo;
  }
  // segunda passada: cabecalho composto ("telefone do whatsapp", "url do site")
  for (const [campo, apelidos] of Object.entries(APELIDOS)) {
    if (apelidos.some((a) => a.length >= 4 && alvo.includes(a))) return campo;
  }
  return null;
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

  cabecalhos.forEach((cab, i) => {
    const campo = campoDoCabecalho(cab);
    if (campo && !usados.has(campo)) {
      mapa[i] = campo;
      usados.add(campo);
    }
  });

  cabecalhos.forEach((cab, i) => {
    if (mapa[i]) return;
    const campo = campoPorValores(amostras[i] || []);
    if (campo && !usados.has(campo)) {
      mapa[i] = campo;
      usados.add(campo);
    }
  });

  return mapa;
}
