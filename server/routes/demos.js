import { Router } from 'express';
import DemoService from '../services/DemoService.js';
import * as leadRepo from '../repositories/leadRepo.js';
import { AppError, naoEncontrado } from '../utils/errors.js';
import { formatarTelefone } from '../utils/phone.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    itens: DemoService.listar({ status: req.query.status, limite: req.query.limite }),
    etapas: DemoService.ETAPAS,
    estatisticas: DemoService.estatisticas()
  });
});

router.get('/estatisticas', (req, res) => res.json(DemoService.estatisticas()));

/**
 * Dados ja preenchidos para a criacao da demo (spec 59.13).
 * Nao existe segundo cadastro: tudo vem do lead que ja esta no CRM.
 */
router.get('/preparar/:leadId', (req, res) => {
  const lead = leadRepo.porId(req.params.leadId);
  if (!lead) throw naoEncontrado('Lead');
  res.json({
    lead_id: lead.id,
    nome: lead.nome_estabelecimento,
    nicho: lead.nicho,
    categoria: lead.categoria,
    cidade: lead.cidade,
    estado: lead.estado,
    endereco: lead.endereco,
    google_maps: lead.google_maps,
    instagram: lead.instagram,
    site: lead.site,
    status_site: lead.status_site,
    telefone: lead.telefone_e164 ? formatarTelefone(lead.telefone_e164) : null,
    avaliacao: lead.avaliacao,
    total_avaliacoes: lead.total_avaliacoes,
    titulo_sugerido: `Modelo para ${lead.nome_estabelecimento}`,
    demos_existentes: DemoService.doLead(lead.id)
  });
});

router.get('/lead/:leadId', (req, res) => res.json(DemoService.doLead(req.params.leadId)));

router.post('/', (req, res) => {
  const { leadId, url, titulo, observacoes } = req.body || {};
  if (!leadId) throw new AppError('Informe o lead da demonstracao.');
  res.status(201).json(DemoService.criar({ leadId: Number(leadId), url, titulo, observacoes }));
});

router.patch('/:id', (req, res) => res.json(DemoService.atualizar(Number(req.params.id), req.body || {})));
router.post('/:id/enviada', (req, res) => res.json(DemoService.marcarEnviada(Number(req.params.id))));
router.post('/:id/acesso', (req, res) => res.json(DemoService.registrarAcesso(Number(req.params.id))));
router.post('/:id/feedback', (req, res) => {
  const texto = String(req.body?.feedback || '').trim();
  if (!texto) throw new AppError('Escreva o feedback do cliente.');
  res.json(DemoService.registrarFeedback(Number(req.params.id), texto));
});
router.post('/:id/status', (req, res) => res.json(DemoService.mudarStatus(Number(req.params.id), req.body?.status)));
router.delete('/:id', (req, res) => res.json(DemoService.excluir(Number(req.params.id))));

export default router;
