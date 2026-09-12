import { all, get } from '../db/index.js';
import * as leadRepo from '../repositories/leadRepo.js';
import * as campaignRepo from '../repositories/campaignRepo.js';
import ActivityService from './ActivityService.js';
import { formatarTelefone } from '../utils/phone.js';
import { AppError } from '../utils/errors.js';

/**
 * Reativacao (spec 70).
 * Encontra oportunidade que esfriou mas continua valendo: interessado antigo,
 * demo que nunca virou negocio, quem perguntou preco e sumiu, negociacao parada.
 */
const GRUPOS = {
  interessados_antigos: {
    nome: 'Interessados que esfriaram',
    descricao: 'Demonstraram interesse e pararam de responder.',
    sql: `SELECT l.* FROM leads l
           WHERE l.respondeu = 1
             AND l.status <> 'FECHADO'
             AND l.etiqueta IN ('INTERESSADO','PEDIU_INFORMACOES','PEDIU_DEMONSTRACAO')
             AND datetime(COALESCE(l.ultima_mensagem_data, l.data_ultimo_contato)) <= datetime('now', ?)`
  },
  perguntaram_preco: {
    nome: 'Perguntaram preco e sumiram',
    descricao: 'Chegaram a falar de valores mas nao fecharam.',
    sql: `SELECT l.* FROM leads l
           WHERE l.etiqueta = 'QUER_SABER_PRECO'
             AND l.status <> 'FECHADO'
             AND datetime(COALESCE(l.ultima_mensagem_data, l.data_ultimo_contato)) <= datetime('now', ?)`
  },
  demos_paradas: {
    nome: 'Demonstracoes sem desfecho',
    descricao: 'Receberam o modelo e a conversa parou.',
    sql: `SELECT l.* FROM leads l
           WHERE EXISTS (SELECT 1 FROM demos d WHERE d.lead_id = l.id AND d.status NOT IN ('FECHADA','DESCARTADA'))
             AND l.status <> 'FECHADO'
             AND datetime(COALESCE(l.ultima_mensagem_data, l.data_ultimo_contato)) <= datetime('now', ?)`
  },
  negociacoes_perdidas: {
    nome: 'Negociacoes paradas',
    descricao: 'Estavam em negociacao e esfriaram.',
    sql: `SELECT l.* FROM leads l
           WHERE l.pipeline = 'NEGOCIACAO'
             AND l.status <> 'FECHADO'
             AND datetime(COALESCE(l.ultima_mensagem_data, l.data_ultimo_contato)) <= datetime('now', ?)`
  },
  sem_resposta: {
    nome: 'Contatados que nunca responderam',
    descricao: 'Receberam a abordagem e nao deram retorno.',
    sql: `SELECT l.* FROM leads l
           WHERE l.quantidade_mensagens_enviadas > 0
             AND l.respondeu = 0
             AND datetime(l.data_ultimo_contato) <= datetime('now', ?)`
  }
};

const enriquecer = (l) => ({
  ...l,
  telefone_formatado: l.telefone_e164 ? formatarTelefone(l.telefone_e164) : null,
  dias_parado: Number(
    get(
      "SELECT CAST(julianday('now') - julianday(COALESCE(?, ?)) AS INTEGER) AS d",
      l.ultima_mensagem_data,
      l.data_ultimo_contato
    )?.d || 0
  )
});

/** Lista os candidatos a reativacao, por grupo. */
export function candidatos({ dias = 15, grupo = null, limite = 200 } = {}) {
  const intervalo = `-${Math.max(1, Number(dias) || 15)} days`;
  const chaves = grupo && GRUPOS[grupo] ? [grupo] : Object.keys(GRUPOS);

  const grupos = chaves.map((chave) => {
    const g = GRUPOS[chave];
    const itens = all(`${g.sql} ORDER BY l.score DESC, l.ultima_mensagem_data DESC LIMIT ?`, intervalo, limite).map(enriquecer);
    return { chave, nome: g.nome, descricao: g.descricao, total: itens.length, itens };
  });

  const vistos = new Set();
  let total = 0;
  for (const g of grupos) {
    for (const l of g.itens) {
      if (!vistos.has(l.id)) {
        vistos.add(l.id);
        total += 1;
      }
    }
  }
  return { dias, total, grupos };
}

export const resumo = ({ dias = 15 } = {}) => {
  const r = candidatos({ dias, limite: 500 });
  return { dias, total: r.total, grupos: r.grupos.map(({ chave, nome, total }) => ({ chave, nome, total })) };
};

/**
 * Monta uma campanha de reativacao com os leads escolhidos.
 * Marca a etapa REATIVACAO e reabre a prospeccao apenas para esses leads.
 */
export function criarCampanha({ leadIds = [], nome = null, delayMin, delayMax, blocoTamanho, blocoPausaMinutos }) {
  if (!leadIds.length) throw new AppError('Selecione pelo menos um lead para reativar.');

  const leads = leadIds.map((id) => leadRepo.porId(id)).filter(Boolean);
  const validos = leads.filter((l) => l.telefone_e164);
  if (!validos.length) throw new AppError('Nenhum dos leads escolhidos tem telefone valido.');

  const campanha = campaignRepo.criar({
    nome: nome || `Reativacao ${new Date().toLocaleDateString('pt-BR')}`,
    quantidade_alvo: validos.length,
    delay_min: delayMin,
    delay_max: delayMax,
    bloco_tamanho: blocoTamanho,
    bloco_pausa_minutos: blocoPausaMinutos,
    filtros: { origem: 'reativacao', leads: validos.map((l) => l.id) }
  });
  campaignRepo.atualizar(campanha.id, { tipo: 'REATIVACAO', descricao: 'Campanha de reativacao de oportunidades' });

  // A trava de duplicidade do CampaignRunner impede reenvio; na reativacao o
  // reenvio e proposital, entao o lead volta para a fila de forma explicita.
  const enfileirados = campaignRepo.enfileirar(campanha.id, validos);
  for (const l of validos) {
    leadRepo.atualizar(l.id, { pipeline: 'REATIVACAO', na_prospeccao: 1 });
    ActivityService.registrar({
      lead_id: l.id,
      tipo: 'REATIVACAO',
      descricao: `Incluido na campanha "${campanha.nome}"`,
      meta: { campaign_id: campanha.id }
    });
  }

  return { campanha: campaignRepo.porId(campanha.id), enfileirados, ignorados: leads.length - validos.length };
}

export default { candidatos, resumo, criarCampanha, GRUPOS };
