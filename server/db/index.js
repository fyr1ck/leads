import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from '../config.js';
import { TAGS_PADRAO } from '../domain/classificacao.js';
import { NICHOS_PADRAO, slugificarNicho } from '../domain/nichos.js';

const here = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(path.dirname(paths.db), { recursive: true });

export const db = new DatabaseSync(paths.db);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

/**
 * node:sqlite so aceita null, number, bigint, string, Uint8Array.
 * Booleano, undefined, Date e objeto sao convertidos aqui para nao explodir
 * no meio de uma campanha.
 */
function bind(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'string') return v;
  if (v instanceof Uint8Array) return v;
  return JSON.stringify(v);
}

const cache = new Map();
function prep(sql) {
  let stmt = cache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    cache.set(sql, stmt);
  }
  return stmt;
}

/** Converte o objeto de prototipo nulo do node:sqlite em objeto comum. */
const plain = (row) => (row ? { ...row } : row);

export const run = (sql, ...params) => prep(sql).run(...params.map(bind));
export const get = (sql, ...params) => plain(prep(sql).get(...params.map(bind)));
export const all = (sql, ...params) => prep(sql).all(...params.map(bind)).map(plain);
export const pluck = (sql, ...params) => {
  const row = get(sql, ...params);
  return row ? Object.values(row)[0] : undefined;
};

/** Transacao sincrona (a API do node:sqlite e sincrona). */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* rollback best-effort */
    }
    throw err;
  }
}

/**
 * Acrescenta colunas que ainda nao existem, sem tocar nos dados.
 * Usado para evoluir o schema sem recriar o banco de quem ja esta usando.
 */
function garantirColunas(tabela, colunas) {
  const existentes = new Set(all(`PRAGMA table_info(${tabela})`).map((c) => c.name));
  for (const [nome, definicao] of Object.entries(colunas)) {
    if (existentes.has(nome)) continue;
    db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${nome} ${definicao}`);
  }
}

/** Etapas antigas -> etapas do pipeline comercial (spec 74). */
const PIPELINE_ANTIGO = {
  NOVOS: 'NOVO',
  RESPONDERAM: 'RESPONDEU',
  INTERESSADOS: 'INTERESSADO',
  DEMONSTRACAO: 'DEMO',
  FECHAMENTO: 'NEGOCIACAO',
  CLIENTE: 'FECHADO'
};

/** Cria o schema e semeia etiquetas/configuracoes padrao. Idempotente. */
export function migrar() {
  const schema = fs.readFileSync(path.resolve(here, 'schema.sql'), 'utf8');
  db.exec(schema);

  // --- colunas novas da v2 (Sales OS) ---
  garantirColunas('leads', {
    estado: 'TEXT',
    nicho: 'TEXT',
    place_id: 'TEXT',
    avaliacao: 'REAL',
    total_avaliacoes: 'INTEGER',
    status_site: 'TEXT',
    temperatura: 'TEXT',
    score_motivos: 'TEXT',
    proxima_acao: 'TEXT',
    proximo_followup: 'TEXT',
    search_id: 'INTEGER',
    descoberto_em: 'TEXT'
  });
  garantirColunas('campaigns', {
    descricao: 'TEXT',
    nicho: 'TEXT',
    localizacao: 'TEXT',
    tipo: "TEXT NOT NULL DEFAULT 'PROSPECCAO'"
  });

  for (const [antigo, novo] of Object.entries(PIPELINE_ANTIGO)) {
    run('UPDATE leads SET pipeline = ? WHERE pipeline = ?', novo, antigo);
    run('UPDATE tags SET pipeline = ? WHERE pipeline = ?', novo, antigo);
    run('UPDATE ai_analyses SET proxima_etapa = ? WHERE proxima_etapa = ?', novo, antigo);
  }

  for (const t of TAGS_PADRAO) {
    run(
      `INSERT INTO tags (slug, nome, emoji, cor, prioridade, score, pipeline, sistema, ordem)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
       ON CONFLICT(slug) DO UPDATE SET
         nome = excluded.nome, emoji = excluded.emoji, cor = excluded.cor,
         prioridade = excluded.prioridade, score = excluded.score,
         pipeline = excluded.pipeline, ordem = excluded.ordem, sistema = 1`,
      t.slug, t.nome, t.emoji, t.cor, t.prioridade, t.score, t.pipeline, t.ordem
    );
  }

  run(
    `INSERT INTO whatsapp_sessions (id, nome, status)
     VALUES (1, 'principal', 'DESCONECTADO')
     ON CONFLICT(id) DO NOTHING`
  );

  // Nichos padrao da busca de leads (spec 59.1).
  for (const n of NICHOS_PADRAO) {
    run(
      `INSERT INTO niches (nome, slug, termo, sistema) VALUES (?,?,?,1)
       ON CONFLICT(slug) DO UPDATE SET nome = excluded.nome, termo = excluded.termo, sistema = 1`,
      n.nome,
      slugificarNicho(n.nome),
      n.termo
    );
  }

  return { ok: true };
}

export function estatisticasBanco() {
  return {
    arquivo: paths.db,
    leads: pluck('SELECT COUNT(*) AS n FROM leads') ?? 0,
    mensagens: pluck('SELECT COUNT(*) AS n FROM messages') ?? 0,
    historico: pluck('SELECT COUNT(*) AS n FROM contact_history') ?? 0,
    campanhas: pluck('SELECT COUNT(*) AS n FROM campaigns') ?? 0
  };
}
