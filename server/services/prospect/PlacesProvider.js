import { config } from '../../config.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

/**
 * Fonte de dados de estabelecimentos: Google Places API (New) - oficial.
 *
 * Só usa endpoints públicos e documentados, com chave própria do usuário
 * (spec 59.18). Não há scraping, bypass de CAPTCHA, evasão de bloqueio nem
 * leitura de área privada. Se um dado não vier da API, ele fica vazio -
 * o sistema nunca inventa (spec 59.6).
 *
 * Trocar de fonte no futuro = escrever outro provider com `buscar()` e
 * `geocodificar()`; o LeadFinderService não conhece o Google.
 */
const BASE_PLACES = 'https://places.googleapis.com/v1';
const BASE_GEOCODE = 'https://maps.googleapis.com/maps/api/geocode/json';

const CAMPOS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.shortFormattedAddress',
  'places.addressComponents',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.rating',
  'places.userRatingCount',
  'places.primaryTypeDisplayName',
  'places.types',
  'places.location',
  'places.businessStatus',
  'nextPageToken'
].join(',');

export const temChave = () => Boolean(config.places.apiKey);

function exigirChave() {
  if (!temChave()) {
    throw new AppError(
      'Busca de leads indisponivel: configure GOOGLE_MAPS_API_KEY no arquivo .env (Places API + Geocoding API habilitadas no Google Cloud).',
      503
    );
  }
}

async function requisitar(url, opcoes = {}, timeout = 25_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const resp = await fetch(url, { ...opcoes, signal: ctrl.signal });
    const texto = await resp.text();
    let dados = null;
    try {
      dados = texto ? JSON.parse(texto) : null;
    } catch {
      dados = { raw: texto };
    }
    if (!resp.ok) {
      const detalhe = dados?.error?.message || dados?.error_message || `HTTP ${resp.status}`;
      const err = new AppError(`Google Places: ${detalhe}`, resp.status === 403 ? 403 : 502);
      err.googleStatus = resp.status;
      throw err;
    }
    return dados;
  } catch (err) {
    if (err.name === 'AbortError') throw new AppError('O Google demorou demais para responder.', 504);
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/** Cidade/estado -> coordenadas, para aplicar o raio da busca (spec 59.2). */
export async function geocodificar(cidade, estado) {
  exigirChave();
  const endereco = [cidade, estado, 'Brasil'].filter(Boolean).join(', ');
  const url = `${BASE_GEOCODE}?address=${encodeURIComponent(endereco)}&region=br&language=pt-BR&key=${config.places.apiKey}`;
  const dados = await requisitar(url, { method: 'GET' });

  if (dados?.status === 'ZERO_RESULTS') return null;
  if (dados?.status && dados.status !== 'OK') {
    // Geocoding desabilitado na conta: dá pra seguir sem raio.
    logger.warn('places', `Geocoding indisponivel (${dados.status}). A busca seguira sem raio.`);
    return null;
  }
  const loc = dados?.results?.[0]?.geometry?.location;
  if (!loc) return null;
  return { lat: loc.lat, lng: loc.lng, endereco: dados.results[0].formatted_address };
}

const componente = (place, tipo) =>
  place?.addressComponents?.find((c) => (c.types || []).includes(tipo))?.longText || null;

const componenteCurto = (place, tipo) =>
  place?.addressComponents?.find((c) => (c.types || []).includes(tipo))?.shortText || null;

/** Normaliza um place do Google para o formato interno. */
function normalizar(place) {
  return {
    place_id: place.id || null,
    nome: place.displayName?.text || null,
    categoria: place.primaryTypeDisplayName?.text || null,
    tipos: place.types || [],
    endereco: place.formattedAddress || place.shortFormattedAddress || null,
    cidade:
      componente(place, 'administrative_area_level_2') ||
      componente(place, 'locality') ||
      componente(place, 'postal_town') ||
      null,
    estado: componenteCurto(place, 'administrative_area_level_1') || null,
    telefone: place.nationalPhoneNumber || place.internationalPhoneNumber || null,
    website: place.websiteUri || null,
    google_maps: place.googleMapsUri || null,
    avaliacao: typeof place.rating === 'number' ? place.rating : null,
    total_avaliacoes: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    operacional: place.businessStatus ? place.businessStatus === 'OPERATIONAL' : null
  };
}

/**
 * Busca estabelecimentos por nicho + localização (spec 59.3).
 * @param {object} p
 * @param {string} p.termo     nicho pesquisado (ex.: "barbearia")
 * @param {string} p.cidade
 * @param {string} p.estado
 * @param {number} p.raioKm
 * @param {number} p.maximo    teto de resultados (a API devolve 20 por página)
 */
export async function buscar({ termo, cidade, estado, raioKm = 10, maximo = 60 }) {
  exigirChave();
  if (!termo) throw new AppError('Informe o nicho da busca.');

  const local = cidade ? await geocodificar(cidade, estado).catch(() => null) : null;
  const textQuery = [termo, cidade ? `em ${cidade}` : '', estado || ''].filter(Boolean).join(' ').trim();

  const resultados = [];
  let pageToken = null;
  let paginas = 0;

  while (resultados.length < maximo && paginas < 3) {
    const corpo = {
      textQuery,
      languageCode: 'pt-BR',
      regionCode: 'BR',
      maxResultCount: Math.min(20, maximo - resultados.length),
      ...(pageToken ? { pageToken } : {}),
      ...(local
        ? {
            locationBias: {
              circle: {
                center: { latitude: local.lat, longitude: local.lng },
                radius: Math.min(50_000, Math.max(500, Number(raioKm || 10) * 1000))
              }
            }
          }
        : {})
    };

    const dados = await requisitar(`${BASE_PLACES}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': config.places.apiKey,
        'X-Goog-FieldMask': CAMPOS
      },
      body: JSON.stringify(corpo)
    });

    const pagina = (dados?.places || []).map(normalizar);
    resultados.push(...pagina);
    paginas += 1;
    pageToken = dados?.nextPageToken || null;
    if (!pageToken || pagina.length === 0) break;
    // A API pede um respiro antes de usar o token da próxima página.
    await new Promise((r) => setTimeout(r, 1500));
  }

  logger.ok('places', `Busca "${textQuery}" retornou ${resultados.length} estabelecimentos.`);
  return { itens: resultados, localizacao: local, textQuery, raioAplicado: Boolean(local) };
}

/** Status mostrado no painel e no /api/health. */
export async function verificarConexao() {
  if (!temChave()) {
    return { conectado: false, configurado: false, motivo: 'GOOGLE_MAPS_API_KEY nao configurada.' };
  }
  try {
    const dados = await requisitar(
      `${BASE_PLACES}/places:searchText`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': config.places.apiKey,
          'X-Goog-FieldMask': 'places.id'
        },
        body: JSON.stringify({ textQuery: 'padaria em Sao Paulo', maxResultCount: 1, languageCode: 'pt-BR', regionCode: 'BR' })
      },
      12_000
    );
    return { conectado: true, configurado: true, motivo: null, amostra: (dados?.places || []).length };
  } catch (err) {
    return { conectado: false, configurado: true, motivo: err.message };
  }
}

export default { buscar, geocodificar, verificarConexao, temChave };
