import { all, get, run, pluck, tx } from '../db/index.js';
import { normalizarTelefone, chaveComparacao } from '../utils/phone.js';
import { rankPrioridade, TAGS_POR_SLUG, grupoOportunidade, faixaPotencial } from '../domain/classificacao.js';
import { dominioDe } from '../domain/nichos.js';

const CAMPOS_ENRIQUECIVEIS = [
  'google_maps', 'endereco', 'cidade', 'instagram', 'categoria', 'site', 'telefone',
  'estado', 'nicho', 'place_id', 'avaliacao', 'total_avaliacoes', 'status_site'
];

const vazio = (v) => v === null || v === undefined || String(v).trim() === '';

/** Chave secundaria de duplicidade: nome + endereco (spec 39). */
export function montarDedupeKey(nome, endereco, cidade) {
  const base = [nome, endereco || cidade || '']
    .join('|')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9|]+/g, ' ')
    .trim();
  return base.replace(/\s+/g, ' ') || null;
}

export function porId(id) {
  return get('SELECT * FROM leads WHERE id = ?', id);
}

export function porTelefone(e164) {
  if (!e164) return null;
  const direto = get('SELECT * FROM leads WHERE telefone_e164 = ?', e164);
  if (direto) return direto;
  // casa por sufixo (nono digito / DDI ausente)
  const chave = chaveComparacao(e164);
  if (!chave) return null;
  return get(
    `SELECT * FROM leads
      WHERE telefone_e164 IS NOT NULL
        AND substr(telefone_e164, -8) = ?
      ORDER BY updated_at DESC LIMIT 1`,
    chave
  );
}

export function porDedupeKey(key) {
  if (!key) return null;
  return get('SELECT * FROM leads WHERE dedupe_key = ?', key);
}

/** Identificador da fonte: o mais confiavel para deduplicar (spec 59.15). */
export const porPlaceId = (placeId) =>
  placeId ? get('SELECT * FROM leads WHERE place_id = ?', placeId) : null;

/** Mesmo dominio de site = provavelmente a mesma empresa (spec 59.15). */
export function porDominioSite(dominio) {
  if (!dominio) return null;
  return get(
    `SELECT * FROM leads
      WHERE site IS NOT NULL AND TRIM(site) <> ''
        AND (site LIKE ? OR site LIKE ?)
      LIMIT 1`,
    `%//${dominio}%`,
    `%//www.${dominio}%`
  );
}

export const porGoogleMaps = (url) =>
  url ? get('SELECT * FROM leads WHERE google_maps = ?', url) : null;

/**
 * Cria o lead ou, se ele ja existir, apenas completa campos vazios.
 * Nunca cria um segundo lead para o mesmo telefone (spec 39).
 * Retorna { acao: 'CRIADO' | 'ATUALIZADO' | 'DUPLICADO', lead }.
 */
export function criarOuEnriquecer(dados, origem = 'IMPORT_XLSX') {
  const e164 = normalizarTelefone(dados.telefone);
  const dedupe = montarDedupeKey(dados.nome_estabelecimento, dados.endereco, dados.cidade);

  // Ordem de deduplicacao (spec 59.15):
  // identificador da fonte -> telefone -> dominio do site -> Google Maps -> nome+endereco
  const existente =
    (dados.place_id && porPlaceId(dados.place_id)) ||
    (e164 && porTelefone(e164)) ||
    (dados.site && porDominioSite(dominioDe(dados.site))) ||
    (dados.google_maps && porGoogleMaps(dados.google_maps)) ||
    (!e164 && porDedupeKey(dedupe)) ||
    null;

  if (existente) {
    const patch = {};
    for (const campo of CAMPOS_ENRIQUECIVEIS) {
      if (vazio(existente[campo]) && !vazio(dados[campo])) patch[campo] = String(dados[campo]).trim();
    }
    if (!existente.telefone_e164 && e164) {
      patch.telefone_e164 = e164;
      patch.dedupe_key = existente.dedupe_key || dedupe;
    }
    if (!Object.keys(patch).length) return { acao: 'DUPLICADO', lead: existente };
    atualizar(existente.id, patch);
    return { acao: 'ATUALIZADO', lead: porId(existente.id) };
  }

  const r = run(
    `INSERT INTO leads
      (nome_estabelecimento, telefone, telefone_e164, google_maps, endereco, cidade, estado,
       instagram, categoria, site, origem, observacoes, dedupe_key, dados_extra,
       nicho, place_id, avaliacao, total_avaliacoes, status_site, search_id, descoberto_em,
       status, pipeline)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'NOVO', 'NOVO')`,
    String(dados.nome_estabelecimento || '').trim(),
    dados.telefone || null,
    e164,
    dados.google_maps || null,
    dados.endereco || null,
    dados.cidade || null,
    dados.estado || null,
    dados.instagram || null,
    dados.categoria || null,
    dados.site || null,
    origem,
    dados.observacoes || null,
    dedupe,
    dados.dados_extra ? JSON.stringify(dados.dados_extra) : null,
    dados.nicho || null,
    dados.place_id || null,
    dados.avaliacao ?? null,
    dados.total_avaliacoes ?? null,
    dados.status_site || null,
    dados.search_id || null,
    dados.descoberto_em || null
  );
  return { acao: 'CRIADO', lead: porId(Number(r.lastInsertRowid)) };
}

const COLUNAS_EDITAVEIS = new Set([
  'nome_estabelecimento', 'telefone', 'telefone_e164', 'google_maps', 'endereco', 'cidade',
  'instagram', 'categoria', 'site', 'status', 'etiqueta', 'prioridade', 'score', 'pipeline',
  'data_ultimo_contato', 'quantidade_mensagens_enviadas', 'respondeu', 'ultima_mensagem',
  'ultima_mensagem_data', 'primeira_resposta_data', 'origem', 'observacoes', 'dedupe_key',
  'na_prospeccao', 'adiado_ate', 'fechado_em', 'dados_extra',
  // v2 - Sales OS
  'estado', 'nicho', 'place_id', 'avaliacao', 'total_avaliacoes', 'status_site',
  'temperatura', 'score_motivos', 'proxima_acao', 'proximo_followup', 'search_id', 'descoberto_em'
]);

export function atualizar(id, patch = {}) {
  const entradas = Object.entries(patch).filter(([k]) => COLUNAS_EDITAVEIS.has(k));
  if (!entradas.length) return porId(id);
  const sets = entradas.map(([k]) => `${k} = ?`).join(', ');
  run(
    `UPDATE leads SET ${sets}, updated_at = datetime('now') WHERE id = ?`,
    ...entradas.map(([, v]) => v),
    id
  );
  return porId(id);
}

export function excluir(id) {
  // O historico em contact_history fica (lead_id vira NULL) - spec 42.
  run('DELETE FROM leads WHERE id = ?', id);
}

/** Registra o envio: contador, data e saida da lista de prospeccao (spec 11). */
export function marcarContatado(id, mensagem, { removerDaProspeccao = true } = {}) {
  return tx(() => {
    run(
      `UPDATE leads SET
         status = CASE WHEN respondeu = 1 THEN status ELSE 'CONTATADO' END,
         quantidade_mensagens_enviadas = quantidade_mensagens_enviadas + 1,
         data_ultimo_contato = datetime('now'),
         ultima_mensagem = ?,
         ultima_mensagem_data = datetime('now'),
         etiqueta = COALESCE(etiqueta, 'AGUARDANDO_RESPOSTA'),
         prioridade = COALESCE(prioridade, 'MEDIA'),
         na_prospeccao = ?,
         updated_at = datetime('now')
       WHERE id = ?`,
      mensagem,
      removerDaProspeccao ? 0 : 1,
      id
    );
    return porId(id);
  });
}

/** Marca que o cliente respondeu (a analise da IA entra depois). */
export function marcarResposta(id, texto) {
  run(
    `UPDATE leads SET
       respondeu = 1,
       status = CASE WHEN status IN ('FECHADO') THEN status ELSE 'RESPONDEU' END,
       pipeline = CASE WHEN pipeline = 'NOVOS' THEN 'RESPONDERAM' ELSE pipeline END,
       ultima_mensagem = ?,
       ultima_mensagem_data = datetime('now'),
       primeira_resposta_data = COALESCE(primeira_resposta_data, datetime('now')),
       na_prospeccao = 0,
       updated_at = datetime('now')
     WHERE id = ?`,
    texto,
    id
  );
  return porId(id);
}

/** Aplica o resultado da analise da IA no lead (etiqueta, prioridade, score). */
export function aplicarAnalise(id, { etiqueta, prioridade, score, pipeline }) {
  const tag = TAGS_POR_SLUG[etiqueta];
  return atualizar(id, {
    etiqueta: etiqueta || null,
    prioridade: prioridade || tag?.prioridade || 'MEDIA',
    score: Number.isFinite(Number(score)) ? Math.round(Number(score)) : tag?.score ?? 40,
    pipeline: pipeline || tag?.pipeline || 'RESPONDERAM'
  });
}

/** TRUE se esse telefone ja recebeu mensagem em qualquer momento (spec 10). */
export function jaFoiContatadoPorTelefone(e164) {
  if (!e164) return false;
  const chave = chaveComparacao(e164);
  const n = pluck(
    `SELECT COUNT(*) AS n FROM contact_history
      WHERE tipo = 'ENVIO' AND telefone IS NOT NULL AND substr(telefone, -8) = ?`,
    chave
  );
  return Number(n || 0) > 0;
}

const ORDENACOES = {
  relevancia: `ORDER BY CASE l.prioridade WHEN 'MAXIMA' THEN 4 WHEN 'ALTA' THEN 3 WHEN 'MEDIA' THEN 2 WHEN 'BAIXA' THEN 1 ELSE 0 END DESC,
                        l.score DESC, COALESCE(l.ultima_mensagem_data, l.data_importacao) DESC`,
  nao_contatados: `ORDER BY l.quantidade_mensagens_enviadas ASC, l.data_importacao ASC`,
  novos: `ORDER BY l.data_importacao DESC, l.id DESC`,
  cidade: `ORDER BY COALESCE(l.cidade, 'zzz') COLLATE NOCASE ASC, l.nome_estabelecimento COLLATE NOCASE ASC`,
  categoria: `ORDER BY COALESCE(l.categoria, 'zzz') COLLATE NOCASE ASC, l.nome_estabelecimento COLLATE NOCASE ASC`,
  nome: `ORDER BY l.nome_estabelecimento COLLATE NOCASE ASC`,
  sem_site: `ORDER BY CASE WHEN l.site IS NULL OR TRIM(l.site) = '' THEN 0 ELSE 1 END ASC, l.data_importacao ASC`,
  resposta_recente: `ORDER BY COALESCE(l.ultima_mensagem_data, l.data_ultimo_contato, l.data_importacao) DESC`
};

/** Monta WHERE + params a partir dos filtros da UI (spec 37). */
export function montarFiltro(f = {}) {
  const where = [];
  const params = [];
  const add = (sql, ...p) => {
    where.push(sql);
    params.push(...p);
  };

  if (f.cidade) add('l.cidade = ? COLLATE NOCASE', f.cidade);
  if (f.categoria) add('l.categoria = ? COLLATE NOCASE', f.categoria);
  if (f.status) add('l.status = ?', f.status);
  if (f.pipeline) add('l.pipeline = ?', f.pipeline);
  if (f.prioridade) add('l.prioridade = ?', f.prioridade);
  if (f.etiqueta) {
    const lista = String(f.etiqueta).split(',').map((s) => s.trim()).filter(Boolean);
    if (lista.length) add(`l.etiqueta IN (${lista.map(() => '?').join(',')})`, ...lista);
  }
  if (f.contatado === 'sim') add('l.quantidade_mensagens_enviadas > 0');
  if (f.contatado === 'nao') add('l.quantidade_mensagens_enviadas = 0');
  if (f.respondeu === 'sim') add('l.respondeu = 1');
  if (f.respondeu === 'nao') add('l.respondeu = 0');
  if (f.temInstagram === 'sim') add("l.instagram IS NOT NULL AND TRIM(l.instagram) <> ''");
  if (f.temInstagram === 'nao') add("(l.instagram IS NULL OR TRIM(l.instagram) = '')");
  if (f.temSite === 'sim') add("l.site IS NOT NULL AND TRIM(l.site) <> ''");
  if (f.temSite === 'nao') add("(l.site IS NULL OR TRIM(l.site) = '')");
  if (f.temTelefone === 'sim') add('l.telefone_e164 IS NOT NULL');
  if (f.temTelefone === 'nao') add('l.telefone_e164 IS NULL');
  if (f.naProspeccao === 'sim') add('l.na_prospeccao = 1');
  if (f.naProspeccao === 'nao') add('l.na_prospeccao = 0');
  if (f.busca) {
    const q = `%${String(f.busca).trim()}%`;
    add(
      `(l.nome_estabelecimento LIKE ? COLLATE NOCASE OR l.telefone LIKE ? OR l.telefone_e164 LIKE ?
        OR l.cidade LIKE ? COLLATE NOCASE OR l.categoria LIKE ? COLLATE NOCASE)`,
      q, q, q, q, q
    );
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function listar(filtros = {}, { ordem = 'relevancia', limite = 100, offset = 0 } = {}) {
  const { sql, params } = montarFiltro(filtros);
  const orderBy = ORDENACOES[ordem] || ORDENACOES.relevancia;
  const total = Number(pluck(`SELECT COUNT(*) AS n FROM leads l ${sql}`, ...params) || 0);
  const itens = all(
    `SELECT l.* FROM leads l ${sql} ${orderBy} LIMIT ? OFFSET ?`,
    ...params,
    Math.min(Number(limite) || 100, 1000),
    Number(offset) || 0
  );
  return { total, itens };
}

/**
 * Leads elegiveis para prospeccao: com telefone, ainda na lista, nunca
 * contatados e que nao aparecem no historico de envios (spec 10 / 38).
 */
export function disponiveisParaProspeccao(filtros = {}, limite = 50) {
  const { sql, params } = montarFiltro({ ...filtros, temTelefone: 'sim', naProspeccao: 'sim', contatado: 'nao' });
  return all(
    `SELECT l.* FROM leads l
      ${sql ? `${sql} AND` : 'WHERE'} l.respondeu = 0
        AND NOT EXISTS (
          SELECT 1 FROM contact_history h
           WHERE h.tipo = 'ENVIO' AND h.telefone IS NOT NULL
             AND substr(h.telefone, -8) = substr(l.telefone_e164, -8)
        )
      ORDER BY CASE WHEN l.site IS NULL OR TRIM(l.site) = '' THEN 0 ELSE 1 END ASC,
               l.data_importacao ASC, l.id ASC
      LIMIT ?`,
    ...params,
    Math.max(1, Number(limite) || 50)
  );
}

export function contadores() {
  const row = get(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN quantidade_mensagens_enviadas > 0 THEN 1 ELSE 0 END) AS contatados,
      SUM(CASE WHEN respondeu = 1 THEN 1 ELSE 0 END) AS responderam,
      SUM(CASE WHEN na_prospeccao = 1 AND telefone_e164 IS NOT NULL AND quantidade_mensagens_enviadas = 0 THEN 1 ELSE 0 END) AS disponiveis,
      SUM(CASE WHEN telefone_e164 IS NULL THEN 1 ELSE 0 END) AS sem_telefone,
      SUM(CASE WHEN site IS NULL OR TRIM(site) = '' THEN 1 ELSE 0 END) AS sem_site,
      SUM(CASE WHEN status = 'FECHADO' THEN 1 ELSE 0 END) AS fechados
    FROM leads`);
  return row || {};
}

export function porEtiqueta() {
  return all(
    `SELECT COALESCE(etiqueta, 'SEM_ETIQUETA') AS etiqueta, COUNT(*) AS total
       FROM leads GROUP BY COALESCE(etiqueta, 'SEM_ETIQUETA') ORDER BY total DESC`
  );
}

export const agrupadoPor = (coluna) => {
  const permitido = { cidade: 'cidade', categoria: 'categoria', pipeline: 'pipeline', status: 'status' };
  const col = permitido[coluna];
  if (!col) return [];
  return all(
    `SELECT COALESCE(NULLIF(TRIM(${col}), ''), 'Nao informado') AS rotulo, COUNT(*) AS total
       FROM leads GROUP BY rotulo ORDER BY total DESC LIMIT 20`
  );
};

export const cidades = () =>
  all("SELECT DISTINCT cidade AS valor FROM leads WHERE cidade IS NOT NULL AND TRIM(cidade) <> '' ORDER BY cidade COLLATE NOCASE").map((r) => r.valor);
export const categorias = () =>
  all("SELECT DISTINCT categoria AS valor FROM leads WHERE categoria IS NOT NULL AND TRIM(categoria) <> '' ORDER BY categoria COLLATE NOCASE").map((r) => r.valor);

/** Central de Oportunidades: quem esta mais perto de comprar (spec 58.2). */
export function oportunidades({ grupo = 'todos', limite = 200 } = {}) {
  const filtros = { respondeu: 'sim' };
  const { sql, params } = montarFiltro(filtros);
  const itens = all(
    `SELECT l.*,
            (SELECT a.sugestao_resposta FROM ai_analyses a WHERE a.lead_id = l.id ORDER BY a.id DESC LIMIT 1) AS sugestao_resposta,
            (SELECT a.motivo FROM ai_analyses a WHERE a.lead_id = l.id ORDER BY a.id DESC LIMIT 1) AS motivo,
            (SELECT a.confianca FROM ai_analyses a WHERE a.lead_id = l.id ORDER BY a.id DESC LIMIT 1) AS confianca,
            (SELECT a.proxima_etapa FROM ai_analyses a WHERE a.lead_id = l.id ORDER BY a.id DESC LIMIT 1) AS proxima_etapa,
            (SELECT COUNT(*) FROM messages m WHERE m.lead_id = l.id) AS total_mensagens
       FROM leads l
       ${sql}
       ${ORDENACOES.relevancia}
       LIMIT ?`,
    ...params,
    Math.min(Number(limite) || 200, 500)
  );
  const agora = Date.now();
  const enriquecidos = itens.map((l) => ({
    ...l,
    rank: rankPrioridade(l.prioridade),
    grupo: grupoOportunidade(l.etiqueta),
    potencial: faixaPotencial(l.score).faixa,
    adiado: l.adiado_ate ? new Date(l.adiado_ate).getTime() > agora : false
  }));
  if (!grupo || grupo === 'todos') return enriquecidos;
  return enriquecidos.filter((l) => l.grupo === grupo);
}

export function marcarFechado(id) {
  return atualizar(id, {
    status: 'FECHADO',
    pipeline: 'CLIENTE',
    etiqueta: 'QUER_CONTRATAR',
    prioridade: 'MAXIMA',
    score: 100,
    fechado_em: new Date().toISOString()
  });
}

export function adiar(id, horas = 24) {
  const ate = new Date(Date.now() + Math.max(1, Number(horas) || 24) * 3600_000);
  return atualizar(id, { adiado_ate: ate.toISOString() });
}

export function moverPipeline(id, etapa) {
  return atualizar(id, { pipeline: etapa });
}

/** Leads ainda nao trabalhados (para EXPORTAR LEADS RESTANTES - spec 12). */
export function restantes() {
  return all(
    `SELECT * FROM leads
      WHERE na_prospeccao = 1 AND quantidade_mensagens_enviadas = 0
      ORDER BY data_importacao ASC`
  );
}

/** Todos os leads ja trabalhados, preservando nome + Google Maps (spec 12). */
export function trabalhados() {
  return all(
    `SELECT * FROM leads
      WHERE quantidade_mensagens_enviadas > 0 OR respondeu = 1
      ORDER BY data_ultimo_contato DESC`
  );
}

/** Tira da lista de prospeccao sem apagar nada do CRM (spec 11). */
export function limparProspeccaoContatados() {
  const r = run(
    `UPDATE leads SET na_prospeccao = 0, updated_at = datetime('now')
      WHERE na_prospeccao = 1 AND (quantidade_mensagens_enviadas > 0 OR respondeu = 1)`
  );
  return Number(r.changes || 0);
}
