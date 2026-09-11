/**
 * SAUDACAO DINAMICA - regra obrigatoria da Skill Henvix (spec 23).
 * 05:00-11:59 "Bom dia!" | 12:00-17:59 "Boa tarde!" | 18:00-04:59 "Boa noite!"
 * Sempre calculada pelo horario atual, nunca aleatoria, nunca fixa.
 * A Skill manda considerar o horario de Brasilia (UTC-3) para operacao no Brasil.
 */
export function horaBrasilia(data = new Date()) {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const [h, m] = fmt.format(data).split(':').map(Number);
  return { hora: h % 24, minuto: m };
}

export function saudacaoDinamica(data = new Date()) {
  const { hora } = horaBrasilia(data);
  if (hora >= 5 && hora < 12) return 'Bom dia';
  if (hora >= 12 && hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function contextoDeHorario(data = new Date()) {
  const { hora, minuto } = horaBrasilia(data);
  return {
    saudacao: saudacaoDinamica(data),
    horaLocal: `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`,
    fuso: 'America/Sao_Paulo (UTC-3)'
  };
}
