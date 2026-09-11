import { all, get, run, pluck } from '../db/index.js';

export function registrar({
  lead_id = null,
  campaign_id = null,
  direcao,
  corpo,
  telefone = null,
  wa_message_id = null,
  status = 'ENVIADA',
  erro = null,
  autor = 'SISTEMA',
  lida = 0
}) {
  const r = run(
    `INSERT INTO messages (lead_id, campaign_id, direcao, corpo, telefone, wa_message_id, status, erro, autor, lida)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    lead_id, campaign_id, direcao, corpo, telefone, wa_message_id, status, erro, autor, lida
  );
  return porId(Number(r.lastInsertRowid));
}

export const porId = (id) => get('SELECT * FROM messages WHERE id = ?', id);

export const doLead = (leadId, limite = 200) =>
  all('SELECT * FROM messages WHERE lead_id = ? ORDER BY created_at ASC, id ASC LIMIT ?', leadId, limite);

export const jaExisteWaId = (waId) =>
  waId ? Number(pluck('SELECT COUNT(*) AS n FROM messages WHERE wa_message_id = ?', waId) || 0) > 0 : false;

export function listar({ direcao, leadId, limite = 100, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (direcao) {
    where.push('direcao = ?');
    params.push(direcao);
  }
  if (leadId) {
    where.push('lead_id = ?');
    params.push(leadId);
  }
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number(pluck(`SELECT COUNT(*) AS n FROM messages ${sql}`, ...params) || 0);
  const itens = all(
    `SELECT m.*, l.nome_estabelecimento, l.cidade, l.etiqueta
       FROM messages m LEFT JOIN leads l ON l.id = m.lead_id
       ${sql} ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`,
    ...params, Math.min(Number(limite) || 100, 500), Number(offset) || 0
  );
  return { total, itens };
}

/** Lista de conversas do inbox (spec 27). */
export function conversas({ limite = 100 } = {}) {
  return all(
    `SELECT l.id AS lead_id, l.nome_estabelecimento, l.cidade, l.categoria, l.telefone_e164,
            l.etiqueta, l.prioridade, l.score, l.google_maps, l.respondeu, l.status, l.pipeline,
            l.ultima_mensagem, l.ultima_mensagem_data,
            (SELECT COUNT(*) FROM messages m2 WHERE m2.lead_id = l.id) AS total_mensagens,
            (SELECT COUNT(*) FROM messages m3 WHERE m3.lead_id = l.id AND m3.direcao = 'IN' AND m3.lida = 0) AS nao_lidas,
            (SELECT m4.direcao FROM messages m4 WHERE m4.lead_id = l.id ORDER BY m4.id DESC LIMIT 1) AS ultima_direcao,
            (SELECT a.sugestao_resposta FROM ai_analyses a WHERE a.lead_id = l.id ORDER BY a.id DESC LIMIT 1) AS sugestao_resposta,
            (SELECT a.confianca FROM ai_analyses a WHERE a.lead_id = l.id ORDER BY a.id DESC LIMIT 1) AS confianca
       FROM leads l
      WHERE EXISTS (SELECT 1 FROM messages m WHERE m.lead_id = l.id)
      ORDER BY COALESCE(l.ultima_mensagem_data, l.data_ultimo_contato) DESC
      LIMIT ?`,
    Math.min(Number(limite) || 100, 500)
  );
}

export const marcarLidas = (leadId) =>
  run("UPDATE messages SET lida = 1 WHERE lead_id = ? AND direcao = 'IN' AND lida = 0", leadId).changes;

export const totalNaoLidas = () =>
  Number(pluck("SELECT COUNT(*) AS n FROM messages WHERE direcao = 'IN' AND lida = 0") || 0);

/** Enviadas hoje - usado pelo limite diario (spec 54). */
export const enviadasHoje = () =>
  Number(
    pluck(
      `SELECT COUNT(*) AS n FROM messages
        WHERE direcao = 'OUT' AND status = 'ENVIADA' AND date(created_at) = date('now', 'localtime')`
    ) || 0
  );

/** Serie diaria para os graficos (spec 31) - sempre dados reais. */
export function serieDiaria(dias = 14) {
  return all(
    `WITH RECURSIVE dias(d) AS (
       SELECT date('now', 'localtime', ${'?'} || ' days')
       UNION ALL
       SELECT date(d, '+1 day') FROM dias WHERE d < date('now', 'localtime')
     )
     SELECT dias.d AS dia,
       (SELECT COUNT(*) FROM messages m WHERE m.direcao = 'OUT' AND date(m.created_at) = dias.d) AS enviadas,
       (SELECT COUNT(*) FROM messages m WHERE m.direcao = 'IN'  AND date(m.created_at) = dias.d) AS respostas,
       (SELECT COUNT(DISTINCT a.lead_id) FROM ai_analyses a
          WHERE date(a.created_at) = dias.d
            AND a.etiqueta IN ('INTERESSADO','PEDIU_DEMONSTRACAO','QUER_SABER_PRECO','NEGOCIANDO','QUER_CONTRATAR')) AS interessados
     FROM dias ORDER BY dia ASC`,
    `-${Math.max(1, Number(dias) || 14) - 1}`
  );
}
