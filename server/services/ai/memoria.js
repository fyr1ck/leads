import { all, get } from '../../db/index.js';
import { formatarTelefone } from '../../utils/phone.js';

/**
 * MEMORIA DO LEAD (spec 64).
 *
 * Monta, a partir do ID do lead (nunca do nome), um bloco curto com o que
 * realmente aconteceu: demos, analises, follow-ups, venda e etapa atual.
 * E isso que a IA recebe junto da conversa - contexto real, sem invencao.
 */
const dias = (iso) => {
  if (!iso) return null;
  const t = new Date(String(iso).includes('T') ? iso : `${String(iso).replace(' ', 'T')}Z`).getTime();
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / 86_400_000);
};

export function montarMemoria(leadId) {
  const lead = get('SELECT * FROM leads WHERE id = ?', leadId);
  if (!lead) return { texto: '', lead: null };

  const linhas = [];

  linhas.push(`ID interno: ${lead.id}`);
  linhas.push(`Etapa atual no funil: ${lead.pipeline}`);
  if (lead.etiqueta) linhas.push(`Etiqueta atual: ${lead.etiqueta.replace(/_/g, ' ').toLowerCase()}`);
  linhas.push(`Score atual: ${lead.score || 0}/100`);

  if (lead.quantidade_mensagens_enviadas) {
    linhas.push(`Mensagens ja enviadas por nos: ${lead.quantidade_mensagens_enviadas}`);
  }
  const d = dias(lead.ultima_mensagem_data || lead.data_ultimo_contato);
  if (d !== null) linhas.push(`Ultima interacao: ha ${d} dia(s)`);

  const demos = all('SELECT * FROM demos WHERE lead_id = ? ORDER BY id DESC LIMIT 3', leadId);
  for (const demo of demos) {
    const partes = [`Demonstracao ${demo.status.toLowerCase()}`];
    if (demo.enviada_em) partes.push(`enviada ha ${dias(demo.enviada_em)} dia(s)`);
    if (demo.acessos > 0) partes.push(`acessada ${demo.acessos}x`);
    else if (demo.enviada_em) partes.push('ainda nao acessada');
    if (demo.feedback) partes.push(`feedback do cliente: "${String(demo.feedback).slice(0, 140)}"`);
    linhas.push(partes.join(', '));
  }

  const analises = all(
    'SELECT etiqueta, motivo, created_at FROM ai_analyses WHERE lead_id = ? ORDER BY id DESC LIMIT 3',
    leadId
  );
  for (const a of analises) {
    if (a.motivo) linhas.push(`Leitura anterior da conversa: ${a.motivo}`);
  }

  const followups = all(
    "SELECT prazo_dias, status, enviado_em FROM follow_ups WHERE lead_id = ? AND status = 'ENVIADO' ORDER BY id DESC LIMIT 3",
    leadId
  );
  if (followups.length) linhas.push(`Follow-ups ja enviados: ${followups.length}`);

  const venda = get('SELECT * FROM sales WHERE lead_id = ? ORDER BY id DESC LIMIT 1', leadId);
  if (venda) linhas.push(`Ja existe venda registrada (status ${venda.status}).`);

  const motivos = (() => {
    try {
      return JSON.parse(lead.score_motivos || '[]');
    } catch {
      return [];
    }
  })();
  if (motivos.length) {
    linhas.push(`Sinais do score: ${motivos.slice(0, 4).map((m) => `${m.pontos > 0 ? '+' : ''}${m.pontos} ${m.texto}`).join('; ')}`);
  }

  return {
    lead,
    texto: linhas.join('\n'),
    telefone: lead.telefone_e164 ? formatarTelefone(lead.telefone_e164) : null
  };
}

export default { montarMemoria };
