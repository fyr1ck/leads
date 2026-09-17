/**
 * Janela de envio da prospeccao ("comeca 08:00, termina 18:00").
 * Sempre no horario de Brasilia, mesmo com o servidor em UTC (VPS).
 * Janela que vira a noite (22:00 -> 02:00) tambem funciona.
 */
const FUSO = 'America/Sao_Paulo';

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: FUSO,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

/** Segundos desde a meia-noite em Brasilia. */
function segundosDoDia(data = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(data).map((x) => [x.type, x.value]));
  return (Number(p.hour) % 24) * 3600 + Number(p.minute) * 60 + Number(p.second);
}

/** "8", "8:00", "08:00" -> "08:00". Invalido -> null. */
export function normalizarHorario(valor) {
  const m = String(valor ?? '').trim().match(/^(\d{1,2})(?:[:h](\d{2}))?h?$/i);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const emSegundos = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 3600 + m * 60;
};

/** Campanha sem horario definido envia a qualquer hora (comportamento antigo). */
export function temJanela(inicio, fim) {
  return Boolean(normalizarHorario(inicio) && normalizarHorario(fim));
}

export function dentroDaJanela(inicio, fim, data = new Date()) {
  if (!temJanela(inicio, fim)) return true;
  const agora = segundosDoDia(data);
  const ini = emSegundos(normalizarHorario(inicio));
  const end = emSegundos(normalizarHorario(fim));
  if (ini === end) return true;
  return ini < end ? agora >= ini && agora < end : agora >= ini || agora < end;
}

/** Milissegundos ate o proximo horario de inicio (0 se ja esta dentro da janela). */
export function msAteAbrir(inicio, fim, data = new Date()) {
  if (dentroDaJanela(inicio, fim, data)) return 0;
  const falta = (emSegundos(normalizarHorario(inicio)) - segundosDoDia(data) + 86400) % 86400;
  return (falta || 86400) * 1000;
}
