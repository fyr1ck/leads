import { all, run } from '../db/index.js';

export function registrar({ nivel = 'info', categoria = 'app', mensagem, meta = null }) {
  run('INSERT INTO logs (nivel, categoria, mensagem, meta) VALUES (?,?,?,?)', nivel, categoria, mensagem, meta ? JSON.stringify(meta) : null);
}

export const listar = ({ limite = 200, nivel, categoria } = {}) => {
  const where = [];
  const params = [];
  if (nivel) {
    where.push('nivel = ?');
    params.push(nivel);
  }
  if (categoria) {
    where.push('categoria = ?');
    params.push(categoria);
  }
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return all(
    `SELECT * FROM logs ${sql} ORDER BY id DESC LIMIT ?`,
    ...params,
    Math.min(Number(limite) || 200, 1000)
  );
};

/** Mantem o arquivo de log enxuto (spec 53: nao guardar dado desnecessario). */
export const podar = (manter = 5000) =>
  run('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT ?)', manter).changes;
