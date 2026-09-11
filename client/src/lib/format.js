export const naoInformado = '—';

const paraData = (valor) => {
  if (!valor) return null;
  // SQLite devolve "YYYY-MM-DD HH:MM:SS" em UTC
  const texto = String(valor);
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(texto) ? `${texto.replace(' ', 'T')}Z` : texto;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

export function hora(valor) {
  const d = paraData(valor);
  return d ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : naoInformado;
}

export function dataHora(valor) {
  const d = paraData(valor);
  return d ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : naoInformado;
}

export function data(valor) {
  const d = paraData(valor);
  return d ? d.toLocaleDateString('pt-BR') : naoInformado;
}

export function tempoRelativo(valor) {
  const d = paraData(valor);
  if (!d) return naoInformado;
  const seg = Math.round((Date.now() - d.getTime()) / 1000);
  if (seg < 60) return 'agora';
  const min = Math.round(seg / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h}h`;
  const dias = Math.round(h / 24);
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;
  return data(valor);
}

export const numero = (v) => new Intl.NumberFormat('pt-BR').format(Number(v || 0));
export const porcento = (v) => `${Number(v || 0).toFixed(1).replace('.', ',')}%`;

export function iniciais(nome) {
  const limpo = String(nome || '').replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
  if (!limpo) return '?';
  const partes = limpo.split(/\s+/).filter(Boolean);
  return ((partes[0]?.[0] || '') + (partes[1]?.[0] || '')).toUpperCase() || '?';
}

export const segundos = (ms) => `${Math.max(0, Math.ceil(ms / 1000))}s`;

export function contagemRegressiva(alvo) {
  if (!alvo) return null;
  const restante = alvo - Date.now();
  if (restante <= 0) return null;
  const s = Math.ceil(restante / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}min ${String(s % 60).padStart(2, '0')}s`;
}

/** Emojis/rotulos das faixas de potencial (spec 58.7). */
export function rotuloPotencial(score = 0) {
  const s = Number(score) || 0;
  if (s >= 81) return { nome: 'Muito alto', cor: '#f97316', emoji: '🔥' };
  if (s >= 61) return { nome: 'Alto', cor: '#fb923c', emoji: '🟠' };
  if (s >= 31) return { nome: 'Médio', cor: '#facc15', emoji: '🟡' };
  return { nome: 'Baixo', cor: '#64748b', emoji: '🔵' };
}

export const nomeEtiqueta = (slug) => String(slug || '').replace(/_/g, ' ').toLowerCase();
