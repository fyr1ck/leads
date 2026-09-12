import { all, get, run, pluck } from '../db/index.js';
import { NICHOS_PADRAO, slugificarNicho } from '../domain/nichos.js';
import { AppError } from '../utils/errors.js';

/* ------------------------------------------------------------------ nichos */

export function semearNichos() {
  for (const n of NICHOS_PADRAO) {
    run(
      `INSERT INTO niches (nome, slug, termo, sistema) VALUES (?,?,?,1)
       ON CONFLICT(slug) DO UPDATE SET nome = excluded.nome, termo = excluded.termo, sistema = 1`,
      n.nome,
      slugificarNicho(n.nome),
      n.termo
    );
  }
}

export const listarNichos = () => all('SELECT * FROM niches ORDER BY sistema DESC, buscas DESC, nome COLLATE NOCASE');
export const nichoPorSlug = (slug) => get('SELECT * FROM niches WHERE slug = ?', slug);

/** Nicho personalizado (spec 59.1) - fica salvo para as proximas buscas. */
export function criarNicho(nome, termo = null) {
  const limpo = String(nome || '').trim();
  if (limpo.length < 2) throw new AppError('Informe um nicho valido.');
  const slug = slugificarNicho(limpo);
  const existente = nichoPorSlug(slug);
  if (existente) return existente;
  run('INSERT INTO niches (nome, slug, termo, sistema) VALUES (?,?,?,0)', limpo, slug, (termo || limpo).toLowerCase());
  return nichoPorSlug(slug);
}

export function excluirNicho(slug) {
  const n = nichoPorSlug(slug);
  if (!n) throw new AppError('Nicho nao encontrado.', 404);
  if (n.sistema) throw new AppError('Nichos padrao nao podem ser excluidos.');
  run('DELETE FROM niches WHERE id = ?', n.id);
  return { ok: true };
}

export const contarBusca = (slug) => run('UPDATE niches SET buscas = buscas + 1 WHERE slug = ?', slug);

/* --------------------------------------------------------- pesquisas salvas */

export function criarPesquisa({ nome, nicho, cidade, estado, raio_km = 10, filtros = null }) {
  const r = run(
    `INSERT INTO saved_searches (nome, nicho, cidade, estado, raio_km, filtros) VALUES (?,?,?,?,?,?)`,
    nome,
    nicho,
    cidade || null,
    estado || null,
    Number(raio_km) || 10,
    filtros ? JSON.stringify(filtros) : null
  );
  return pesquisaPorId(Number(r.lastInsertRowid));
}

export const pesquisaPorId = (id) => get('SELECT * FROM saved_searches WHERE id = ?', id);
export const listarPesquisas = () => all('SELECT * FROM saved_searches ORDER BY id DESC LIMIT 100');

export function atualizarPesquisa(id, patch = {}) {
  const permitido = ['nome', 'nicho', 'cidade', 'estado', 'raio_km', 'filtros', 'total_encontrados', 'total_adicionados', 'execucoes', 'ultima_execucao'];
  const entradas = Object.entries(patch).filter(([k]) => permitido.includes(k));
  if (!entradas.length) return pesquisaPorId(id);
  run(
    `UPDATE saved_searches SET ${entradas.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`,
    ...entradas.map(([, v]) => (v && typeof v === 'object' ? JSON.stringify(v) : v)),
    id
  );
  return pesquisaPorId(id);
}

export function registrarExecucao(id, totalEncontrados) {
  run(
    `UPDATE saved_searches
        SET execucoes = execucoes + 1,
            ultima_execucao = datetime('now'),
            total_encontrados = ?
      WHERE id = ?`,
    totalEncontrados,
    id
  );
  return pesquisaPorId(id);
}

export function excluirPesquisa(id) {
  run('DELETE FROM saved_searches WHERE id = ?', id);
  return { ok: true };
}

/* --------------------------------------------------------- resultados */

export function salvarResultado(dados) {
  const r = run(
    `INSERT INTO search_results
      (search_id, place_id, nome, categoria, endereco, cidade, estado, telefone, telefone_e164,
       google_maps, site, instagram, avaliacao, total_avaliacoes, status_site, prioridade, nicho, origem, bruto)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    dados.search_id ?? null,
    dados.place_id ?? null,
    dados.nome,
    dados.categoria ?? null,
    dados.endereco ?? null,
    dados.cidade ?? null,
    dados.estado ?? null,
    dados.telefone ?? null,
    dados.telefone_e164 ?? null,
    dados.google_maps ?? null,
    dados.site ?? null,
    dados.instagram ?? null,
    dados.avaliacao ?? null,
    dados.total_avaliacoes ?? null,
    dados.status_site ?? null,
    dados.prioridade ?? null,
    dados.nicho ?? null,
    dados.origem ?? 'google_places',
    dados.bruto ? JSON.stringify(dados.bruto) : null
  );
  return get('SELECT * FROM search_results WHERE id = ?', Number(r.lastInsertRowid));
}

export const resultadoPorId = (id) => get('SELECT * FROM search_results WHERE id = ?', id);

export const resultadosDaPesquisa = (searchId, limite = 200) =>
  all('SELECT * FROM search_results WHERE search_id = ? ORDER BY id DESC LIMIT ?', searchId, limite);

export const marcarResultadoAdicionado = (id, leadId) =>
  run('UPDATE search_results SET adicionado = 1, lead_id = ? WHERE id = ?', leadId, id);

/** Ja vimos esse place em alguma busca anterior? */
export const resultadoPorPlaceId = (placeId) =>
  placeId ? get('SELECT * FROM search_results WHERE place_id = ? ORDER BY id DESC LIMIT 1', placeId) : null;

export const totalResultados = () => Number(pluck('SELECT COUNT(*) AS n FROM search_results') || 0);
