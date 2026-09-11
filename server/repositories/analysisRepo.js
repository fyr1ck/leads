import { all, get, run } from '../db/index.js';

export function registrar(dados) {
  const r = run(
    `INSERT INTO ai_analyses
      (lead_id, message_id, etiqueta, prioridade, confianca, score, motivo, sugestao_resposta, proxima_etapa, modelo, bruto)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    dados.lead_id ?? null,
    dados.message_id ?? null,
    dados.etiqueta ?? null,
    dados.prioridade ?? null,
    dados.confianca ?? null,
    dados.score ?? null,
    dados.motivo ?? null,
    dados.sugestao_resposta ?? null,
    dados.proxima_etapa ?? null,
    dados.modelo ?? null,
    dados.bruto ? JSON.stringify(dados.bruto) : null
  );
  return porId(Number(r.lastInsertRowid));
}

export const porId = (id) => get('SELECT * FROM ai_analyses WHERE id = ?', id);

export const ultimaDoLead = (leadId) =>
  get('SELECT * FROM ai_analyses WHERE lead_id = ? ORDER BY id DESC LIMIT 1', leadId);

export const doLead = (leadId, limite = 50) =>
  all('SELECT * FROM ai_analyses WHERE lead_id = ? ORDER BY id DESC LIMIT ?', leadId, limite);
