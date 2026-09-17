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
  quantidade_padrao_prospeccao: 50,
  // horario automatico da prospeccao (Brasilia): comeca e termina sozinha
  horario_ativo: 1,
  horario_inicio: '08:00',
  horario_fim: '18:00',
  // v2 - Sales OS
  followup_dias: '1,3,7',
  followup_automatico: 1,
  reativacao_dias: 15,
  busca_raio_km: 10,
  busca_somente_sem_site: 1,
  // espelhar as etiquetas do CRM nas etiquetas do WhatsApp Business
  wa_etiquetas_sync: 1
});

/**
 * LIMITE_DIARIO do .env e o teto: o painel pode baixar, nunca subir
 * (0 no .env = sem teto). Conta so mensagens de prospeccao.
 */
export function limiteDiarioEfetivo(cfg = obterTodas()) {
  const teto = Number(config.operacao.limiteDiario) || 0;
  const painel = Number(cfg.limite_diario) || 0;
  if (!teto) return painel;
  return painel > 0 ? Math.min(painel, teto) : teto;
}

const CHAVES_NUMERICAS = new Set([
  'delay_min', 'delay_max', 'bloco_tamanho', 'bloco_pausa_minutos', 'limite_diario',
  'max_erros_consecutivos', 'ia_analise_automatica', 'ia_resposta_automatica',
  'remover_da_prospeccao_ao_contatar', 'quantidade_padrao_prospeccao', 'horario_ativo',
  'followup_automatico', 'reativacao_dias', 'busca_raio_km', 'busca_somente_sem_site',
  'wa_etiquetas_sync'
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
