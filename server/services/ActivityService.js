import { all, get, run, pluck } from '../db/index.js';
import { bus, EVENTOS } from '../realtime/bus.js';

/**
 * Timeline do lead (spec 76) + central de notificacoes (spec 75).
 * Toda parte do sistema registra aqui, entao a ficha do lead conta a historia
 * inteira: encontrado, importado, contatado, respondeu, score, demo, venda.
 */
export const TIPOS = {
  LEAD_CRIADO: { titulo: 'Lead criado', icone: '\u{1F195}' },
  LEAD_ENCONTRADO: { titulo: 'Lead encontrado na busca', icone: '\u{1F50E}' },
  LEAD_IMPORTADO: { titulo: 'Lead importado da planilha', icone: '\u{1F4C5}' },
  MENSAGEM_ENVIADA: { titulo: 'Mensagem enviada', icone: '\u{1F4E4}' },
  MENSAGEM_RECEBIDA: { titulo: 'Cliente respondeu', icone: '\u{1F4AC}' },
  SCORE: { titulo: 'Score alterado', icone: '\u{1F525}' },
  ETIQUETA: { titulo: 'Etiqueta aplicada', icone: '\u{1F3F7}' },
  PIPELINE: { titulo: 'Etapa alterada', icone: '\u{1F504}' },
  DEMO_CRIADA: { titulo: 'Demonstracao criada', icone: '\u{1F310}' },
  DEMO_ENVIADA: { titulo: 'Demonstracao enviada', icone: '\u{1F517}' },
  DEMO_ACESSADA: { titulo: 'Demonstracao acessada', icone: '\u{1F440}' },
  DEMO_FEEDBACK: { titulo: 'Feedback da demonstracao', icone: '\u{1F4DD}' },
  FOLLOWUP_CRIADO: { titulo: 'Follow-up agendado', icone: '\u{23F0}' },
  FOLLOWUP_ENVIADO: { titulo: 'Follow-up enviado', icone: '\u{1F4E8}' },
  FOLLOWUP_CANCELADO: { titulo: 'Follow-up cancelado', icone: '\u{1F6AB}' },
  VENDA: { titulo: 'Venda registrada', icone: '\u{1F4B0}' },
  PAGAMENTO: { titulo: 'Pagamento registrado', icone: '\u{1F4B3}' },
  REATIVACAO: { titulo: 'Lead entrou em reativacao', icone: '\u{267B}' },
  OBSERVACAO: { titulo: 'Observacao', icone: '\u{1F4DD}' }
};

export function registrar({ lead_id = null, tipo, titulo = null, descricao = null, meta = null }) {
  const padrao = TIPOS[tipo] || { titulo: tipo, icone: '\u{2022}' };
  const r = run(
    'INSERT INTO activities (lead_id, tipo, titulo, descricao, icone, meta) VALUES (?,?,?,?,?,?)',
    lead_id,
    tipo,
    titulo || padrao.titulo,
    descricao,
    padrao.icone,
    meta ? JSON.stringify(meta) : null
  );
  const atividade = get('SELECT * FROM activities WHERE id = ?', Number(r.lastInsertRowid));
  bus.emit(EVENTOS.ATIVIDADE, atividade);
  return atividade;
}

export const doLead = (leadId, limite = 100) =>
  all('SELECT * FROM activities WHERE lead_id = ? ORDER BY id DESC LIMIT ?', leadId, limite);

export const recentes = (limite = 50) =>
  all(
    `SELECT a.*, l.nome_estabelecimento
       FROM activities a LEFT JOIN leads l ON l.id = a.lead_id
      ORDER BY a.id DESC LIMIT ?`,
    limite
  );

/* ------------------------------------------------------------ notificacoes */

export function notificar({ tipo, titulo, texto = null, lead_id = null, rota = null }) {
  const r = run(
    'INSERT INTO notifications (tipo, titulo, texto, lead_id, rota) VALUES (?,?,?,?,?)',
    tipo,
    titulo,
    texto,
    lead_id,
    rota
  );
  const notificacao = get('SELECT * FROM notifications WHERE id = ?', Number(r.lastInsertRowid));
  bus.emit(EVENTOS.NOTIFICACAO, notificacao);
  return notificacao;
}

export const listarNotificacoes = ({ limite = 40, apenasNaoLidas = false } = {}) =>
  all(
    `SELECT n.*, l.nome_estabelecimento
       FROM notifications n LEFT JOIN leads l ON l.id = n.lead_id
      ${apenasNaoLidas ? 'WHERE n.lida = 0' : ''}
      ORDER BY n.id DESC LIMIT ?`,
    limite
  );

export const naoLidas = () => Number(pluck('SELECT COUNT(*) AS n FROM notifications WHERE lida = 0') || 0);

export const marcarLida = (id) => run('UPDATE notifications SET lida = 1 WHERE id = ?', id).changes;
export const marcarTodasLidas = () => run('UPDATE notifications SET lida = 1 WHERE lida = 0').changes;

export default { registrar, doLead, recentes, notificar, listarNotificacoes, naoLidas, marcarLida, marcarTodasLidas, TIPOS };
