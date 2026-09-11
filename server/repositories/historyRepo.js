import { all, get, run, pluck } from '../db/index.js';

/**
 * Historico permanente (spec 8 / 42).
 * Sobrevive a limpeza da planilha e a exclusao do lead: guarda
 * estabelecimento, telefone e Google Maps junto (spec 12).
 */
export function registrar({
  lead = null,
  lead_id = null,
  campaign_id = null,
  campanha_nome = null,
  tipo,
  mensagem = null,
  status = null,
  resposta = null,
  etiqueta = null
}) {
  const r = run(
    `INSERT INTO contact_history
      (lead_id, campaign_id, telefone, estabelecimento, google_maps, cidade, tipo, mensagem, status, resposta, etiqueta, campanha_nome)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    lead_id ?? lead?.id ?? null,
    campaign_id,
    lead?.telefone_e164 ?? lead?.telefone ?? null,
    lead?.nome_estabelecimento ?? null,
    lead?.google_maps ?? null,
    lead?.cidade ?? null,
    tipo,
    mensagem,
    status,
    resposta,
    etiqueta,
    campanha_nome
  );
  return get('SELECT * FROM contact_history WHERE id = ?', Number(r.lastInsertRowid));
}

export const doLead = (leadId, limite = 200) =>
  all('SELECT * FROM contact_history WHERE lead_id = ? ORDER BY created_at DESC, id DESC LIMIT ?', leadId, limite);

export function listar({ tipo, limite = 200, offset = 0 } = {}) {
  const where = tipo ? 'WHERE tipo = ?' : '';
  const params = tipo ? [tipo] : [];
  const total = Number(pluck(`SELECT COUNT(*) AS n FROM contact_history ${where}`, ...params) || 0);
  const itens = all(
    `SELECT * FROM contact_history ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    ...params, Math.min(Number(limite) || 200, 2000), Number(offset) || 0
  );
  return { total, itens };
}

export const totalEnvios = () =>
  Number(pluck("SELECT COUNT(*) AS n FROM contact_history WHERE tipo = 'ENVIO'") || 0);
