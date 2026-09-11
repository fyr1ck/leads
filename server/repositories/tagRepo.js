import { all, get, run } from '../db/index.js';
import { AppError } from '../utils/errors.js';

export const listar = () => all('SELECT * FROM tags ORDER BY ordem ASC, id ASC');
export const porSlug = (slug) => get('SELECT * FROM tags WHERE slug = ?', slug);

function slugify(nome) {
  return String(nome)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/** Etiquetas personalizadas (spec 17). */
export function criar({ nome, emoji = '\u{1F3F7}', cor = '#38bdf8', prioridade = 'MEDIA', score = 40, pipeline = 'RESPONDERAM' }) {
  const slug = slugify(nome);
  if (!slug) throw new AppError('Informe um nome valido para a etiqueta.');
  if (porSlug(slug)) throw new AppError('Ja existe uma etiqueta com esse nome.');
  const ordem = Number(get('SELECT COALESCE(MAX(ordem), 0) + 1 AS n FROM tags')?.n || 100);
  run(
    `INSERT INTO tags (slug, nome, emoji, cor, prioridade, score, pipeline, sistema, ordem)
     VALUES (?,?,?,?,?,?,?,0,?)`,
    slug, String(nome).trim(), emoji, cor, prioridade, score, pipeline, ordem
  );
  return porSlug(slug);
}

export function excluir(slug) {
  const tag = porSlug(slug);
  if (!tag) throw new AppError('Etiqueta nao encontrada.', 404);
  if (tag.sistema) throw new AppError('Etiquetas padrao do sistema nao podem ser excluidas.');
  run('DELETE FROM tags WHERE id = ?', tag.id);
  run("UPDATE leads SET etiqueta = NULL WHERE etiqueta = ?", slug);
  return { ok: true };
}

export function vincular(leadId, slug, origem = 'OPERADOR') {
  const tag = porSlug(slug);
  if (!tag) throw new AppError('Etiqueta nao encontrada.', 404);
  run(
    'INSERT INTO lead_tags (lead_id, tag_id, origem) VALUES (?,?,?) ON CONFLICT(lead_id, tag_id) DO NOTHING',
    leadId, tag.id, origem
  );
  return tag;
}

export const doLead = (leadId) =>
  all(
    `SELECT t.*, lt.origem, lt.created_at AS aplicada_em
       FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id
      WHERE lt.lead_id = ? ORDER BY lt.created_at DESC`,
    leadId
  );
