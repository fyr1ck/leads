import { all, get, run, pluck, tx } from '../db/index.js';
import { SLUGS_QUENTES, SLUGS_FRIOS } from '../domain/classificacao.js';

const listaSql = (arr) => arr.map((s) => `'${s}'`).join(',');

export function criar({
  nome,
  quantidade_alvo = 0,
  delay_min = 30,
  delay_max = 90,
  bloco_tamanho = 10,
  bloco_pausa_minutos = 5,
  filtros = null
}) {
  const r = run(
    `INSERT INTO campaigns (nome, quantidade_alvo, delay_min, delay_max, bloco_tamanho, bloco_pausa_minutos, filtros, status)
     VALUES (?,?,?,?,?,?,?, 'RASCUNHO')`,
    nome, quantidade_alvo, delay_min, delay_max, bloco_tamanho, bloco_pausa_minutos,
    filtros ? JSON.stringify(filtros) : null
  );
  return porId(Number(r.lastInsertRowid));
}

export const porId = (id) => get('SELECT * FROM campaigns WHERE id = ?', id);

export const listar = ({ limite = 50 } = {}) =>
  all('SELECT * FROM campaigns ORDER BY id DESC LIMIT ?', Math.min(Number(limite) || 50, 200));

export const ativas = () => all("SELECT * FROM campaigns WHERE status IN ('ATIVA','PAUSADA') ORDER BY id DESC");

const COLUNAS = new Set([
  'nome', 'quantidade_alvo', 'status', 'delay_min', 'delay_max', 'bloco_tamanho',
  'bloco_pausa_minutos', 'filtros', 'enviados', 'erros', 'ignorados', 'ultimo_erro',
  'motivo_parada', 'started_at', 'finished_at'
]);

export function atualizar(id, patch = {}) {
  const entradas = Object.entries(patch).filter(([k]) => COLUNAS.has(k));
  if (!entradas.length) return porId(id);
  const sets = entradas.map(([k]) => `${k} = ?`).join(', ');
  run(`UPDATE campaigns SET ${sets}, updated_at = datetime('now') WHERE id = ?`, ...entradas.map(([, v]) => v), id);
  return porId(id);
}

/** Monta a fila persistente da campanha (spec 54). */
export function enfileirar(campaignId, leads) {
  return tx(() => {
    let ordem = Number(pluck('SELECT COALESCE(MAX(ordem), 0) AS n FROM campaign_leads WHERE campaign_id = ?', campaignId) || 0);
    let inseridos = 0;
    for (const lead of leads) {
      ordem += 1;
      const r = run(
        `INSERT INTO campaign_leads (campaign_id, lead_id, ordem) VALUES (?,?,?)
         ON CONFLICT(campaign_id, lead_id) DO NOTHING`,
        campaignId, lead.id, ordem
      );
      if (Number(r.changes || 0) > 0) {
        inseridos += 1;
        run("UPDATE leads SET status = 'NA_FILA', updated_at = datetime('now') WHERE id = ? AND status = 'NOVO'", lead.id);
      }
    }
    return inseridos;
  });
}

export const proximoPendente = (campaignId) =>
  get(
    `SELECT cl.*, l.* , cl.id AS item_id, cl.status AS item_status
       FROM campaign_leads cl JOIN leads l ON l.id = cl.lead_id
      WHERE cl.campaign_id = ? AND cl.status = 'PENDENTE'
      ORDER BY cl.ordem ASC LIMIT 1`,
    campaignId
  );

export const itens = (campaignId, limite = 500) =>
  all(
    `SELECT cl.id AS item_id, cl.status AS item_status, cl.mensagem, cl.erro, cl.enviado_em, cl.ordem,
            l.id AS lead_id, l.nome_estabelecimento, l.cidade, l.categoria, l.telefone_e164,
            l.etiqueta, l.prioridade, l.respondeu, l.google_maps
       FROM campaign_leads cl JOIN leads l ON l.id = cl.lead_id
      WHERE cl.campaign_id = ? ORDER BY cl.ordem ASC LIMIT ?`,
    campaignId, Math.min(Number(limite) || 500, 2000)
  );

export function marcarItem(itemId, status, { mensagem = null, erro = null } = {}) {
  run(
    `UPDATE campaign_leads SET status = ?, mensagem = COALESCE(?, mensagem), erro = ?,
            enviado_em = CASE WHEN ? = 'ENVIADO' THEN datetime('now') ELSE enviado_em END
      WHERE id = ?`,
    status, mensagem, erro, status, itemId
  );
}

export function incrementar(campaignId, campo) {
  if (!['enviados', 'erros', 'ignorados'].includes(campo)) return;
  run(`UPDATE campaigns SET ${campo} = ${campo} + 1, updated_at = datetime('now') WHERE id = ?`, campaignId);
}

/** Progresso em tempo real (spec 14). */
export function progresso(campaignId) {
  const c = porId(campaignId);
  if (!c) return null;
  const q = get(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN cl.status = 'ENVIADO' THEN 1 ELSE 0 END) AS enviados,
       SUM(CASE WHEN cl.status = 'PENDENTE' THEN 1 ELSE 0 END) AS pendentes,
       SUM(CASE WHEN cl.status = 'ERRO' THEN 1 ELSE 0 END) AS erros,
       SUM(CASE WHEN cl.status = 'IGNORADO' THEN 1 ELSE 0 END) AS ignorados,
       SUM(CASE WHEN l.respondeu = 1 THEN 1 ELSE 0 END) AS respostas,
       SUM(CASE WHEN l.etiqueta IN (${listaSql(SLUGS_QUENTES)}) THEN 1 ELSE 0 END) AS interessados,
       SUM(CASE WHEN l.etiqueta IN (${listaSql(SLUGS_FRIOS)}) THEN 1 ELSE 0 END) AS nao_interessados,
       SUM(CASE WHEN cl.status = 'ENVIADO' AND l.respondeu = 0 THEN 1 ELSE 0 END) AS aguardando
     FROM campaign_leads cl JOIN leads l ON l.id = cl.lead_id
     WHERE cl.campaign_id = ?`,
    campaignId
  );
  return {
    campanha: c,
    total: Number(q?.total || 0),
    enviados: Number(q?.enviados || 0),
    pendentes: Number(q?.pendentes || 0),
    erros: Number(q?.erros || 0),
    ignorados: Number(q?.ignorados || 0),
    respostas: Number(q?.respostas || 0),
    interessados: Number(q?.interessados || 0),
    nao_interessados: Number(q?.nao_interessados || 0),
    aguardando: Number(q?.aguardando || 0)
  };
}

export function excluir(id) {
  run('DELETE FROM campaigns WHERE id = ?', id);
}
