import { Router } from 'express';
import * as messageRepo from '../repositories/messageRepo.js';
import * as leadRepo from '../repositories/leadRepo.js';
import * as analysisRepo from '../repositories/analysisRepo.js';
import * as historyRepo from '../repositories/historyRepo.js';
import { naoEncontrado } from '../utils/errors.js';
import { formatarTelefone } from '../utils/phone.js';
import { faixaPotencial, grupoOportunidade } from '../domain/classificacao.js';

const router = Router();

/** Lista de conversas do inbox (spec 27). */
router.get('/', (req, res) => {
  const itens = messageRepo.conversas({ limite: req.query.limite }).map((c) => ({
    ...c,
    telefone_formatado: c.telefone_e164 ? formatarTelefone(c.telefone_e164) : null,
    potencial: faixaPotencial(c.score),
    grupo: grupoOportunidade(c.etiqueta)
  }));
  res.json({ total: itens.length, itens, naoLidas: messageRepo.totalNaoLidas() });
});

/** RESPOSTAS RECEBIDAS (spec 26): so quem respondeu. */
router.get('/responderam', (req, res) => {
  const itens = messageRepo
    .conversas({ limite: 300 })
    .filter((c) => c.respondeu)
    .map((c) => ({
      ...c,
      telefone_formatado: c.telefone_e164 ? formatarTelefone(c.telefone_e164) : null,
      potencial: faixaPotencial(c.score),
      grupo: grupoOportunidade(c.etiqueta)
    }));
  res.json({ total: itens.length, itens });
});

router.get('/:leadId', (req, res) => {
  const lead = leadRepo.porId(req.params.leadId);
  if (!lead) throw naoEncontrado('Conversa');
  res.json({
    lead: {
      ...lead,
      telefone_formatado: lead.telefone_e164 ? formatarTelefone(lead.telefone_e164) : lead.telefone,
      potencial: faixaPotencial(lead.score),
      grupo: grupoOportunidade(lead.etiqueta)
    },
    mensagens: messageRepo.doLead(lead.id, 400),
    // A ultima analise traz a SUGESTAO da IA - exibicao apenas (spec 29).
    analise: analysisRepo.ultimaDoLead(lead.id),
    historico: historyRepo.doLead(lead.id, 50)
  });
});

router.post('/:leadId/lida', (req, res) => {
  const lead = leadRepo.porId(req.params.leadId);
  if (!lead) throw naoEncontrado('Conversa');
  const marcadas = messageRepo.marcarLidas(lead.id);
  res.json({ ok: true, marcadas, naoLidas: messageRepo.totalNaoLidas() });
});

export default router;
