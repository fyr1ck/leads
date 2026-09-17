import { Router } from 'express';
import * as campaignRepo from '../repositories/campaignRepo.js';
import * as leadRepo from '../repositories/leadRepo.js';
import * as settingsRepo from '../repositories/settingsRepo.js';
import campaignRunner from '../services/CampaignRunner.js';
import { asyncHandler } from '../middleware/index.js';
import { AppError, naoEncontrado } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { normalizarHorario } from '../utils/horario.js';

const router = Router();

const idDoPedido = (req) => Number(req.params.id || req.body?.id || req.body?.campanhaId);

router.get('/', (req, res) => {
  const campanhas = campaignRepo.listar({ limite: req.query.limite });
  res.json(campanhas.map((c) => ({ ...c, progresso: campaignRunner.estado(c.id) })));
});

/**
 * Cria a campanha e monta a fila: "quantos chamar hoje" (spec 9 / 36).
 * A selecao ja exclui quem foi contatado antes (spec 10).
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const cfg = settingsRepo.obterTodas();
    const quantidade = Math.max(1, Number(req.body?.quantidade || cfg.quantidade_padrao_prospeccao || 50));
    const filtros = req.body?.filtros || {};

    const disponiveis = leadRepo.disponiveisParaProspeccao(filtros, quantidade);
    if (!disponiveis.length) {
      throw new AppError('Nenhum lead disponivel com esses filtros. Importe uma planilha ou ajuste os filtros.', 409);
    }

    // horario automatico: sem ele a campanha envia a qualquer hora (como antes)
    const horarioAtivo = req.body?.horarioAtivo ?? Boolean(cfg.horario_ativo);
    let horario_inicio = null;
    let horario_fim = null;
    if (horarioAtivo) {
      horario_inicio = normalizarHorario(req.body?.horarioInicio ?? cfg.horario_inicio);
      horario_fim = normalizarHorario(req.body?.horarioFim ?? cfg.horario_fim);
      if (!horario_inicio || !horario_fim) throw new AppError('Informe o horario de inicio e de fim no formato 08:00.');
      if (horario_inicio === horario_fim) throw new AppError('O horario de inicio e de fim nao podem ser iguais.');
    }
    // o formulario abre com o ultimo horario usado
    settingsRepo.salvar({
      horario_ativo: horarioAtivo ? 1 : 0,
      ...(horarioAtivo ? { horario_inicio, horario_fim } : {})
    });

    const nome =
      String(req.body?.nome || '').trim() ||
      `Prospeccao ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

    const campanha = campaignRepo.criar({
      nome,
      quantidade_alvo: disponiveis.length,
      delay_min: Number(req.body?.delayMin ?? cfg.delay_min),
      delay_max: Number(req.body?.delayMax ?? cfg.delay_max),
      bloco_tamanho: Number(req.body?.blocoTamanho ?? cfg.bloco_tamanho),
      bloco_pausa_minutos: Number(req.body?.blocoPausaMinutos ?? cfg.bloco_pausa_minutos),
      filtros,
      horario_inicio,
      horario_fim
    });

    const enfileirados = campaignRepo.enfileirar(campanha.id, disponiveis);
    logger.ok('campanha', `Campanha "${campanha.nome}" criada com ${enfileirados} leads na fila.`);

    res.status(201).json({
      campanha: campaignRepo.porId(campanha.id),
      enfileirados,
      progresso: campaignRunner.estado(campanha.id),
      leads: disponiveis.map((l) => ({
        id: l.id,
        nome_estabelecimento: l.nome_estabelecimento,
        cidade: l.cidade,
        categoria: l.categoria
      }))
    });
  })
);

router.get('/:id', (req, res) => {
  const campanha = campaignRepo.porId(req.params.id);
  if (!campanha) throw naoEncontrado('Campanha');
  res.json({
    campanha,
    progresso: campaignRunner.estado(campanha.id),
    itens: campaignRepo.itens(campanha.id)
  });
});

// ------------------------------------------------- controles (spec 14)
const acao = (fn) =>
  asyncHandler(async (req, res) => {
    const id = idDoPedido(req);
    if (!id) throw new AppError('Informe o id da campanha.');
    if (!campaignRepo.porId(id)) throw naoEncontrado('Campanha');
    res.json(await fn(id, req));
  });

router.post('/start', acao((id) => campaignRunner.iniciar(id)));
router.post('/:id/start', acao((id) => campaignRunner.iniciar(id)));

router.post('/pause', acao((id, req) => campaignRunner.pausar(id, req.body?.motivo)));
router.post('/:id/pause', acao((id, req) => campaignRunner.pausar(id, req.body?.motivo)));

router.post('/resume', acao((id) => campaignRunner.continuar(id)));
router.post('/:id/resume', acao((id) => campaignRunner.continuar(id)));

router.post('/stop', acao((id, req) => campaignRunner.parar(id, req.body?.motivo)));
router.post('/:id/stop', acao((id, req) => campaignRunner.parar(id, req.body?.motivo)));

router.delete('/:id', (req, res) => {
  const campanha = campaignRepo.porId(req.params.id);
  if (!campanha) throw naoEncontrado('Campanha');
  if (campanha.status === 'ATIVA') throw new AppError('Pare a campanha antes de excluir.');
  campaignRepo.excluir(campanha.id);
  res.json({ ok: true, historicoPreservado: true });
});

export default router;
