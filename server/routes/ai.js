import { Router } from 'express';
import AIService from '../services/ai/AIService.js';
import * as leadRepo from '../repositories/leadRepo.js';
import * as messageRepo from '../repositories/messageRepo.js';
import * as analysisRepo from '../repositories/analysisRepo.js';
import { asyncHandler } from '../middleware/index.js';
import { AppError, naoEncontrado } from '../utils/errors.js';
import { carregarSkill } from '../services/ai/skillLoader.js';
import { montarMemoria } from '../services/ai/memoria.js';
import { faixaPotencial, grupoOportunidade } from '../domain/classificacao.js';

const router = Router();

router.get('/status', asyncHandler(async (req, res) => res.json(await AIService.status())));

/** Recarrega a Skill do disco (util depois de editar o arquivo). */
router.post('/skill/reload', (req, res) => {
  carregarSkill({ forcar: true });
  res.json({ ok: true });
});

/** Gera a primeira mensagem de prospeccao de um lead (spec 22). */
router.post(
  '/generate',
  asyncHandler(async (req, res) => {
    const lead = req.body?.leadId ? leadRepo.porId(req.body.leadId) : req.body?.lead;
    if (!lead) throw naoEncontrado('Lead');
    const resultado = await AIService.gerarPrimeiraMensagem(lead);
    res.json(resultado);
  })
);

/**
 * Analisa uma mensagem recebida.
 * Retorna classificacao + sugestao; NAO envia nada para o cliente (spec 16 / 50).
 */
router.post(
  '/analyze',
  asyncHandler(async (req, res) => {
    const { leadId, mensagem, salvar = false } = req.body || {};
    const lead = leadId ? leadRepo.porId(leadId) : null;
    if (!lead) throw naoEncontrado('Lead');
    const texto = String(mensagem || lead.ultima_mensagem || '').trim();
    if (!texto) throw new AppError('Informe a mensagem que deve ser analisada.');

    const historico = messageRepo.doLead(lead.id, 20);
    const analise = await AIService.analisarResposta({ lead, mensagem: texto, historico });

    if (salvar) {
      analysisRepo.registrar({
        lead_id: lead.id,
        etiqueta: analise.etiqueta,
        prioridade: analise.prioridade,
        confianca: analise.confianca,
        score: analise.score,
        motivo: analise.motivo,
        sugestao_resposta: analise.sugestao_resposta,
        proxima_etapa: analise.proxima_etapa,
        modelo: analise.modelo || analise.origem,
        bruto: analise.bruto || null
      });
      leadRepo.aplicarAnalise(lead.id, analise);
    }

    res.json({
      ...analise,
      potencial: faixaPotencial(analise.score),
      grupo: grupoOportunidade(analise.etiqueta),
      enviadoAutomaticamente: false
    });
  })
);

/**
 * COPILOTO DE VENDAS (spec 63).
 * Resumo, intencao, objecao, temperatura, proxima acao e resposta sugerida.
 * Retorna `enviadoAutomaticamente: false` sempre: quem envia e o operador.
 */
router.post(
  '/copiloto',
  asyncHandler(async (req, res) => {
    const lead = leadRepo.porId(req.body?.leadId);
    if (!lead) throw naoEncontrado('Lead');
    const historico = messageRepo.doLead(lead.id, 30);
    const r = await AIService.copiloto({ lead, historico });
    res.json({ ...r, lead_id: lead.id, memoria: montarMemoria(lead.id).texto });
  })
);

/** Sugestao do proximo passo comercial (spec 58.6). Apenas exibicao. */
router.post(
  '/suggest',
  asyncHandler(async (req, res) => {
    const lead = leadRepo.porId(req.body?.leadId);
    if (!lead) throw naoEncontrado('Lead');
    const historico = messageRepo.doLead(lead.id, 20);
    const r = await AIService.sugerirProximoPasso({ lead, historico });
    res.json({ ...r, enviadoAutomaticamente: false });
  })
);

export default router;
