import { Router } from 'express';
import * as leadRepo from '../repositories/leadRepo.js';
import { get } from '../db/index.js';
import { formatarTelefone } from '../utils/phone.js';
import {
  faixaPotencial,
  PIPELINE,
  SLUGS_QUENTES,
  SLUGS_ACOMPANHAMENTO,
  SLUGS_AGUARDANDO,
  SLUGS_FRIOS,
  TAGS_POR_SLUG
} from '../domain/classificacao.js';

const router = Router();
const lista = (arr) => arr.map((s) => `'${s}'`).join(',');

const FILTROS = {
  todos: null,
  quentes: SLUGS_QUENTES,
  alta: SLUGS_ACOMPANHAMENTO,
  aguardando: SLUGS_AGUARDANDO,
  frios: SLUGS_FRIOS,
  preco: ['QUER_SABER_PRECO'],
  demonstracao: ['PEDIU_DEMONSTRACAO'],
  interessados: ['INTERESSADO'],
  nao_interessados: ['NAO_INTERESSADO', 'RECUSOU']
};

/**
 * CENTRAL DE OPORTUNIDADES (spec 58).
 * Responde visualmente a "quem eu devo chamar agora para ter mais chance de fechar".
 */
router.get('/', (req, res) => {
  const filtro = String(req.query.filtro || 'todos');
  const permitidos = FILTROS[filtro] ?? null;

  const itens = leadRepo
    .oportunidades({ limite: req.query.limite || 200 })
    .filter((l) => !permitidos || permitidos.includes(l.etiqueta))
    .map((l) => {
      const tag = TAGS_POR_SLUG[l.etiqueta];
      const ultima = l.ultima_mensagem_data ? new Date(l.ultima_mensagem_data) : null;
      return {
        ...l,
        telefone_formatado: l.telefone_e164 ? formatarTelefone(l.telefone_e164) : null,
        etiqueta_nome: tag?.nome || l.etiqueta,
        etiqueta_emoji: tag?.emoji || '\u{1F3F7}',
        etiqueta_cor: tag?.cor || '#64748b',
        potencial: faixaPotencial(l.score),
        horas_desde_resposta: ultima ? Math.max(0, Math.round((Date.now() - ultima.getTime()) / 3600_000)) : null
      };
    });

  res.json({ total: itens.length, itens, filtro });
});

/** Contadores do topo da Central (spec 58.10). */
router.get('/contadores', (req, res) => {
  const row = get(`
    SELECT
      SUM(CASE WHEN etiqueta IN (${lista(SLUGS_QUENTES)}) THEN 1 ELSE 0 END) AS quentes,
      SUM(CASE WHEN etiqueta IN (${lista(SLUGS_ACOMPANHAMENTO)}) THEN 1 ELSE 0 END) AS acompanhamento,
      SUM(CASE WHEN etiqueta IN (${lista(SLUGS_AGUARDANDO)}) THEN 1 ELSE 0 END) AS aguardando,
      SUM(CASE WHEN etiqueta IN (${lista(SLUGS_FRIOS)}) THEN 1 ELSE 0 END) AS frios,
      SUM(CASE WHEN status = 'FECHADO' THEN 1 ELSE 0 END) AS fechados
    FROM leads WHERE respondeu = 1 OR status = 'FECHADO'`);
  res.json({
    quentes: Number(row?.quentes || 0),
    acompanhamento: Number(row?.acompanhamento || 0),
    aguardando: Number(row?.aguardando || 0),
    frios: Number(row?.frios || 0),
    fechados: Number(row?.fechados || 0)
  });
});

/** PIPELINE VISUAL / Kanban (spec 58.12). */
router.get('/pipeline', (req, res) => {
  const todos = leadRepo.oportunidades({ limite: 500 });
  const colunas = PIPELINE.map((etapa) => ({
    ...etapa,
    leads: todos
      .filter((l) => l.pipeline === etapa.slug)
      .map((l) => ({
        id: l.id,
        nome_estabelecimento: l.nome_estabelecimento,
        cidade: l.cidade,
        etiqueta: l.etiqueta,
        etiqueta_emoji: TAGS_POR_SLUG[l.etiqueta]?.emoji || '\u{1F3F7}',
        score: l.score,
        prioridade: l.prioridade,
        ultima_mensagem: l.ultima_mensagem,
        google_maps: l.google_maps
      }))
  }));
  res.json({ colunas });
});

export default router;
