import { all, get, run } from '../db/index.js';
import { config } from '../config.js';

/** Configuracoes que o operador altera pelo painel (spec 13 / 28 / 54). */
const PADROES = () => ({
  delay_min: config.operacao.delayMin,
  delay_max: config.operacao.delayMax,
  bloco_tamanho: config.operacao.blocoTamanho,
  bloco_pausa_minutos: config.operacao.blocoPausaMinutos,
  limite_diario: config.operacao.limiteDiario,
  max_erros_consecutivos: config.operacao.maxErrosConsecutivos,
  link_demonstracao: config.operacao.linkDemonstracao,
  ia_analise_automatica: 1,
  // REGRA DE OURO: fica 0 e o backend nao tem caminho para enviar resposta sozinho.
  ia_resposta_automatica: 0,
  remover_da_prospeccao_ao_contatar: 1,
  quantidade_padrao_prospeccao: 50
});

const CHAVES_NUMERICAS = new Set([
  'delay_min', 'delay_max', 'bloco_tamanho', 'bloco_pausa_minutos', 'limite_diario',
  'max_erros_consecutivos', 'ia_analise_automatica', 'ia_resposta_automatica',
  'remover_da_prospeccao_ao_contatar', 'quantidade_padrao_prospeccao'
]);

const parse = (chave, valor) => {
  if (valor === null || valor === undefined) return null;
  if (CHAVES_NUMERICAS.has(chave)) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
  }
  return valor;
};

export function obterTodas() {
  const linhas = all('SELECT chave, valor FROM settings');
  const salvo = Object.fromEntries(linhas.map((l) => [l.chave, parse(l.chave, l.valor)]));
  const out = { ...PADROES(), ...salvo };
  // Trava de seguranca: nunca permitir resposta automatica (spec 15 / 28 / 50).
  out.ia_resposta_automatica = 0;
  return out;
}

export function obter(chave) {
  const row = get('SELECT valor FROM settings WHERE chave = ?', chave);
  if (!row) return PADROES()[chave] ?? null;
  return parse(chave, row.valor);
}

export function salvar(patch = {}) {
  for (const [chave, valor] of Object.entries(patch)) {
    if (chave === 'ia_resposta_automatica') continue; // imutavel por design
    run(
      `INSERT INTO settings (chave, valor, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, updated_at = datetime('now')`,
      chave,
      valor === null || valor === undefined ? null : String(valor)
    );
  }
  return obterTodas();
}
