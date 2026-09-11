/**
 * Normalizacao de telefone.
 * O telefone e o identificador unico do lead (spec 10 / 39).
 */

/** Somente digitos. */
export const digitos = (v) => String(v ?? '').replace(/\D+/g, '');

/**
 * Converte para o formato interno (E.164 sem "+"), assumindo Brasil quando o
 * DDI nao vem na planilha. Retorna null quando nao ha numero utilizavel -
 * o sistema nunca inventa telefone (spec 52).
 */
export function normalizarTelefone(valor) {
  let d = digitos(valor);
  if (!d) return null;
  d = d.replace(/^00/, '');
  if (d.length > 11 && d.startsWith('0')) d = d.slice(1);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if (d.length <= 9) return null; // sem DDD: inutilizavel
  if (d.length <= 15) return d; // numero internacional ja completo
  return null;
}

/**
 * Variantes brasileiras (com e sem o nono digito) para consultar no WhatsApp.
 * Serve apenas para descobrir qual numero realmente existe antes de enviar.
 */
export function variantesBR(e164) {
  const d = digitos(e164);
  if (!d.startsWith('55')) return [d];
  const ddd = d.slice(2, 4);
  const resto = d.slice(4);
  const out = new Set([d]);
  if (resto.length === 9 && resto.startsWith('9')) out.add(`55${ddd}${resto.slice(1)}`);
  if (resto.length === 8) out.add(`55${ddd}9${resto}`);
  return [...out];
}

/** Chave curta para casar mensagem recebida com lead (ignora nono digito/DDI). */
export function chaveComparacao(valor) {
  const d = digitos(valor);
  return d.length >= 8 ? d.slice(-8) : d;
}

/** Exibicao: +55 (16) 99999-9999 */
export function formatarTelefone(valor) {
  const d = digitos(valor);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const n = d.slice(4);
    const meio = n.length === 9 ? `${n.slice(0, 5)}-${n.slice(5)}` : `${n.slice(0, 4)}-${n.slice(4)}`;
    return `+55 (${ddd}) ${meio}`;
  }
  return d ? `+${d}` : '';
}

export const jidDeTelefone = (e164) => `${digitos(e164)}@s.whatsapp.net`;
export const telefoneDeJid = (jid) => digitos(String(jid).split('@')[0].split(':')[0]);
