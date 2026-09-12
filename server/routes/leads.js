import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { paths } from '../config.js';
import * as leadRepo from '../repositories/leadRepo.js';
import * as messageRepo from '../repositories/messageRepo.js';
import * as historyRepo from '../repositories/historyRepo.js';
import * as analysisRepo from '../repositories/analysisRepo.js';
import * as tagRepo from '../repositories/tagRepo.js';
import ImportService from '../services/ImportService.js';
import MessageService from '../services/MessageService.js';
import LabelService from '../services/whatsapp/LabelService.js';
import { asyncHandler } from '../middleware/index.js';
import { AppError, naoEncontrado } from '../utils/errors.js';
import { formatarTelefone } from '../utils/phone.js';
import { faixaPotencial, grupoOportunidade, PIPELINE_SLUGS } from '../domain/classificacao.js';
import { bus, EVENTOS } from '../realtime/bus.js';

const router = Router();

const EXTENSOES = new Set(['.xlsx', '.xlsm', '.csv']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, paths.uploads),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^\w.-]+/g, '_')}`)
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!EXTENSOES.has(ext)) return cb(new AppError('Envie um arquivo .xlsx (ou .csv).', 400));
    cb(null, true);
  }
});

/** Enriquecimento usado nas telas (nao muda o banco). */
function comExtras(lead) {
  if (!lead) return lead;
  return {
    ...lead,
    telefone_formatado: lead.telefone_e164 ? formatarTelefone(lead.telefone_e164) : lead.telefone || null,
    potencial: faixaPotencial(lead.score),
    grupo: grupoOportunidade(lead.etiqueta),
    dados_extra: lead.dados_extra ? safeJson(lead.dados_extra) : null
  };
}
const safeJson = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- importacao
/** Previa do mapeamento de colunas antes de gravar nada. */
router.post(
  '/import/analisar',
  upload.single('arquivo'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('Nenhum arquivo recebido.');
    try {
      res.json(await ImportService.analisar(req.file.path));
    } finally {
      ImportService.removerArquivo(req.file.path);
    }
  })
);

router.post(
  '/import',
  upload.single('arquivo'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('Nenhum arquivo recebido.');
    try {
      const resultado = await ImportService.importar(req.file.path, { nomeOriginal: req.file.originalname });
      res.json(resultado);
    } finally {
      ImportService.removerArquivo(req.file.path);
    }
  })
);

router.get('/import/historico', (req, res) => res.json(ImportService.historicoImportacoes(20)));

// ---------------------------------------------------------------- listagem
router.get('/', (req, res) => {
  const { ordem, limite, offset, ...filtros } = req.query;
  const { total, itens } = leadRepo.listar(filtros, { ordem, limite, offset });
  res.json({ total, itens: itens.map(comExtras) });
});

router.get('/filtros/opcoes', (req, res) => {
  res.json({
    cidades: leadRepo.cidades(),
    categorias: leadRepo.categorias(),
    etiquetas: tagRepo.listar(),
    pipeline: PIPELINE_SLUGS,
    contadores: leadRepo.contadores()
  });
});

router.get('/contadores', (req, res) => res.json(leadRepo.contadores()));

/** Leads que entrariam na proxima prospeccao (spec 36). */
router.get('/disponiveis', (req, res) => {
  const { quantidade = 50, ...filtros } = req.query;
  const itens = leadRepo.disponiveisParaProspeccao(filtros, Number(quantidade));
  res.json({ total: itens.length, itens: itens.map(comExtras) });
});

// ---------------------------------------------------------------- detalhe
router.get('/:id', (req, res) => {
  const lead = leadRepo.porId(req.params.id);
  if (!lead) throw naoEncontrado('Lead');
  res.json({
    lead: comExtras(lead),
    mensagens: messageRepo.doLead(lead.id, 300),
    historico: historyRepo.doLead(lead.id),
    analises: analysisRepo.doLead(lead.id, 20),
    etiquetas: tagRepo.doLead(lead.id)
  });
});

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const lead = leadRepo.porId(req.params.id);
    if (!lead) throw naoEncontrado('Lead');
    const atualizado = leadRepo.atualizar(lead.id, req.body || {});
    bus.emit(EVENTOS.LEAD_ATUALIZADO, { lead: atualizado });
    res.json(comExtras(atualizado));
  })
);

router.delete('/:id', (req, res) => {
  const lead = leadRepo.porId(req.params.id);
  if (!lead) throw naoEncontrado('Lead');
  leadRepo.excluir(lead.id);
  bus.emit(EVENTOS.STATS, {});
  res.json({ ok: true, historicoPreservado: true });
});

// ---------------------------------------------------------------- acoes
router.post('/:id/etiqueta', (req, res) => {
  const lead = leadRepo.porId(req.params.id);
  if (!lead) throw naoEncontrado('Lead');
  const slug = String(req.body?.etiqueta || '').trim();
  const tag = tagRepo.porSlug(slug);
  if (!tag) throw new AppError('Etiqueta invalida.');
  const etiquetaAnterior = lead.etiqueta;
  const atualizado = leadRepo.aplicarAnalise(lead.id, {
    etiqueta: tag.slug,
    prioridade: tag.prioridade,
    score: req.body?.score ?? tag.score,
    pipeline: req.body?.pipeline || tag.pipeline
  });
  tagRepo.vincular(lead.id, tag.slug, 'OPERADOR');
  // espelha no WhatsApp (best-effort: nunca derruba a troca de etiqueta aqui)
  LabelService.aplicarNoLead(atualizado, tag.slug, etiquetaAnterior).catch(() => {});
  historyRepo.registrar({ lead: atualizado, tipo: 'ETIQUETA', status: tag.slug, etiqueta: tag.slug, resposta: 'Definida pelo operador.' });
  bus.emit(EVENTOS.LEAD_ATUALIZADO, { lead: atualizado });
  bus.emit(EVENTOS.STATS, {});
  res.json(comExtras(atualizado));
});

router.post('/:id/pipeline', (req, res) => {
  const lead = leadRepo.porId(req.params.id);
  if (!lead) throw naoEncontrado('Lead');
  const etapa = String(req.body?.pipeline || '').toUpperCase();
  if (!PIPELINE_SLUGS.includes(etapa)) throw new AppError('Etapa invalida.');
  const atualizado = leadRepo.moverPipeline(lead.id, etapa);
  bus.emit(EVENTOS.LEAD_ATUALIZADO, { lead: atualizado });
  res.json(comExtras(atualizado));
});

/** [MARCAR COMO FECHADO] (spec 58.13) - registra e mantem todo o historico. */
router.post('/:id/fechar', (req, res) => {
  const lead = leadRepo.porId(req.params.id);
  if (!lead) throw naoEncontrado('Lead');
  const atualizado = leadRepo.marcarFechado(lead.id);
  historyRepo.registrar({
    lead: atualizado,
    tipo: 'FECHAMENTO',
    status: 'FECHADO',
    resposta: req.body?.observacao || null,
    etiqueta: atualizado.etiqueta
  });
  bus.emit(EVENTOS.LEAD_ATUALIZADO, { lead: atualizado });
  bus.emit(EVENTOS.STATS, {});
  res.json(comExtras(atualizado));
});

router.post('/:id/adiar', (req, res) => {
  const lead = leadRepo.porId(req.params.id);
  if (!lead) throw naoEncontrado('Lead');
  const atualizado = leadRepo.adiar(lead.id, req.body?.horas ?? 24);
  bus.emit(EVENTOS.LEAD_ATUALIZADO, { lead: atualizado });
  res.json(comExtras(atualizado));
});

/**
 * Envio MANUAL do operador (spec 29 / 50).
 * A IA nunca chama esta rota: quem decide enviar e a pessoa.
 */
router.post(
  '/:id/mensagem',
  asyncHandler(async (req, res) => {
    const lead = leadRepo.porId(req.params.id);
    if (!lead) throw naoEncontrado('Lead');
    const texto = String(req.body?.texto || '').trim();
    if (!texto) throw new AppError('Escreva a mensagem antes de enviar.');
    const r = await MessageService.enviar({ lead, texto, autor: 'OPERADOR' });
    res.json({ mensagem: r.mensagem, lead: comExtras(r.lead) });
  })
);

/** Tira os contatados da lista de prospeccao, sem apagar o CRM (spec 11). */
router.post('/limpar-prospeccao', (req, res) => {
  const removidos = leadRepo.limparProspeccaoContatados();
  bus.emit(EVENTOS.STATS, {});
  res.json({ removidos, historicoPreservado: true });
});

export default router;
