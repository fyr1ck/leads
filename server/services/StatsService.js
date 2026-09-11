import { get, all } from '../db/index.js';
import * as leadRepo from '../repositories/leadRepo.js';
import * as messageRepo from '../repositories/messageRepo.js';
import * as historyRepo from '../repositories/historyRepo.js';
import {
  SLUGS_QUENTES,
  SLUGS_ACOMPANHAMENTO,
  SLUGS_AGUARDANDO,
  SLUGS_FRIOS,
  TAGS_POR_SLUG,
  PIPELINE
} from '../domain/classificacao.js';

const lista = (arr) => arr.map((s) => `'${s}'`).join(',');
const n = (v) => Number(v || 0);

/**
 * Todos os numeros do dashboard vem do banco real (spec 31).
 * Nenhum valor ficticio em nenhum card ou grafico.
 */
export function dashboard() {
  const c = leadRepo.contadores();

  const etiquetas = get(`
    SELECT
      SUM(CASE WHEN etiqueta IN (${lista(SLUGS_QUENTES)}) THEN 1 ELSE 0 END) AS quentes,
      SUM(CASE WHEN etiqueta IN (${lista(SLUGS_ACOMPANHAMENTO)}) THEN 1 ELSE 0 END) AS acompanhamento,
      SUM(CASE WHEN etiqueta IN (${lista(SLUGS_AGUARDANDO)}) THEN 1 ELSE 0 END) AS aguardando,
      SUM(CASE WHEN etiqueta IN (${lista(SLUGS_FRIOS)}) THEN 1 ELSE 0 END) AS frios,
      SUM(CASE WHEN etiqueta = 'INTERESSADO' THEN 1 ELSE 0 END) AS interessados,
      SUM(CASE WHEN etiqueta = 'NEGOCIANDO' THEN 1 ELSE 0 END) AS negociando,
      SUM(CASE WHEN etiqueta = 'NAO_INTERESSADO' THEN 1 ELSE 0 END) AS nao_interessados
    FROM leads`);

  const enviadas = n(get("SELECT COUNT(*) AS v FROM messages WHERE direcao = 'OUT' AND status = 'ENVIADA'")?.v);
  const recebidas = n(get("SELECT COUNT(*) AS v FROM messages WHERE direcao = 'IN'")?.v);
  const contatados = n(c.contatados);
  const responderam = n(c.responderam);

  return {
    cards: {
      leads_importados: n(c.total),
      leads_contatados: contatados,
      responderam,
      interessados: n(etiquetas?.quentes),
      aguardando: n(etiquetas?.aguardando) + n(etiquetas?.acompanhamento),
      nao_interessados: n(etiquetas?.frios),
      negociacoes: n(etiquetas?.negociando),
      conversoes: n(c.fechados)
    },
    oportunidades: {
      quentes: n(etiquetas?.quentes),
      acompanhamento: n(etiquetas?.acompanhamento),
      aguardando: n(etiquetas?.aguardando),
      frios: n(etiquetas?.frios)
    },
    operacao: {
      disponiveis: n(c.disponiveis),
      sem_telefone: n(c.sem_telefone),
      sem_site: n(c.sem_site),
      enviadas_total: enviadas,
      enviadas_hoje: messageRepo.enviadasHoje(),
      recebidas_total: recebidas,
      nao_lidas: messageRepo.totalNaoLidas(),
      historico_envios: historyRepo.totalEnvios()
    },
    taxas: {
      resposta: contatados ? Number(((responderam / contatados) * 100).toFixed(1)) : 0,
      interesse: responderam ? Number(((n(etiquetas?.quentes) / responderam) * 100).toFixed(1)) : 0,
      conversao: contatados ? Number(((n(c.fechados) / contatados) * 100).toFixed(1)) : 0
    }
  };
}

export function graficos({ dias = 14 } = {}) {
  return {
    serie: messageRepo.serieDiaria(dias),
    porEtiqueta: leadRepo
      .porEtiqueta()
      .map((r) => ({
        slug: r.etiqueta,
        rotulo: TAGS_POR_SLUG[r.etiqueta]?.nome || 'Sem etiqueta',
        emoji: TAGS_POR_SLUG[r.etiqueta]?.emoji || '\u{26AA}',
        cor: TAGS_POR_SLUG[r.etiqueta]?.cor || '#475569',
        total: n(r.total)
      })),
    porCidade: leadRepo.agrupadoPor('cidade'),
    porCategoria: leadRepo.agrupadoPor('categoria'),
    pipeline: PIPELINE.map((etapa) => ({
      ...etapa,
      total: n(get('SELECT COUNT(*) AS v FROM leads WHERE pipeline = ?', etapa.slug)?.v)
    }))
  };
}

/** Blocos "OPORTUNIDADES QUENTES" do dashboard (spec 58.9). */
export function oportunidadesQuentes(limite = 5) {
  return all(
    `SELECT l.id, l.nome_estabelecimento, l.cidade, l.etiqueta, l.prioridade, l.score,
            l.ultima_mensagem, l.ultima_mensagem_data, l.google_maps
       FROM leads l
      WHERE l.etiqueta IN (${lista(SLUGS_QUENTES)})
      ORDER BY CASE l.prioridade WHEN 'MAXIMA' THEN 4 WHEN 'ALTA' THEN 3 WHEN 'MEDIA' THEN 2 ELSE 1 END DESC,
               l.score DESC, l.ultima_mensagem_data DESC
      LIMIT ?`,
    Math.min(Number(limite) || 5, 20)
  );
}

export default { dashboard, graficos, oportunidadesQuentes };
