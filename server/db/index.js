import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from '../config.js';
import { TAGS_PADRAO } from '../domain/classificacao.js';

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

/** Cria o schema e semeia etiquetas/configuracoes padrao. Idempotente. */
export function migrar() {
  const schema = fs.readFileSync(path.resolve(here, 'schema.sql'), 'utf8');
  db.exec(schema);

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
