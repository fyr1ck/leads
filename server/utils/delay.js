import { config } from '../config.js';

/** Espera cancelavel - permite PAUSAR/PARAR a campanha na hora (spec 14). */
export function esperaCancelavel(ms, sinal) {
  return new Promise((resolve) => {
    if (sinal?.cancelado) return resolve('cancelado');
    const fim = () => {
      clearTimeout(t);
      resolve('cancelado');
    };
    const t = setTimeout(() => {
      sinal?.limpar?.(fim);
      resolve('fim');
    }, ms);
    sinal?.registrar?.(fim);
  });
}

/**
 * DELAY_MIN do .env e o piso de seguranca: intervalo menor digitado no painel
 * ou gravado numa campanha antiga e puxado para cima. Com 5-10s o WhatsApp
 * restringiu o numero por envio em massa.
 */
export function faixaSegura(minSeg, maxSeg) {
  const piso = Math.max(1, Number(config.operacao.delayMin) || 1);
  const min = Math.max(piso, Number(minSeg) || piso);
  return { min, max: Math.max(min, Number(maxSeg) || min) };
}

/** Intervalo aleatorio dentro da faixa configurada - nunca fixo (spec 13). */
export function delayAleatorio(minSeg, maxSeg) {
  const min = Math.max(1, Number(minSeg) || 1);
  const max = Math.max(min, Number(maxSeg) || min);
  const seg = min + Math.random() * (max - min);
  return Math.round(seg * 1000);
}

/** Sinal de cancelamento simples e reutilizavel. */
export function criarSinal() {
  const handlers = new Set();
  return {
    cancelado: false,
    registrar(fn) {
      handlers.add(fn);
    },
    limpar(fn) {
      handlers.delete(fn);
    },
    cancelar() {
      this.cancelado = true;
      for (const fn of handlers) fn();
      handlers.clear();
    },
    reset() {
      this.cancelado = false;
      handlers.clear();
    }
  };
}
