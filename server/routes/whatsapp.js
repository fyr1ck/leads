import { Router } from 'express';
import whatsapp from '../services/whatsapp/WhatsAppService.js';
import LabelService from '../services/whatsapp/LabelService.js';
import * as leadRepo from '../repositories/leadRepo.js';
import { asyncHandler } from '../middleware/index.js';
import { AppError } from '../utils/errors.js';

const router = Router();

router.get('/status', (req, res) => res.json(whatsapp.estado()));

router.post(
  '/connect',
  asyncHandler(async (req, res) => {
    const estado = await whatsapp.conectar();
    res.json(estado);
  })
);

router.post(
  '/reconnect',
  asyncHandler(async (req, res) => {
    res.json(await whatsapp.reconectar());
  })
);

router.post(
  '/disconnect',
  asyncHandler(async (req, res) => {
    // logout=true remove a sessao salva e forca QR Code novo na proxima conexao.
    const logout = req.body?.logout !== false;
    res.json(await whatsapp.desconectar({ logout }));
  })
);

/* ------------------------------------------------ etiquetas do WhatsApp */

/** Estado do espelhamento das etiquetas do CRM no WhatsApp Business. */
router.get('/labels', (req, res) => res.json(LabelService.estado()));

/** Cria/mapeia as etiquetas do painel dentro do WhatsApp. */
router.post(
  '/labels/sync',
  asyncHandler(async (req, res) => {
    res.json(await LabelService.sincronizar({ forcar: Boolean(req.body?.forcar) }));
  })
);

/** Reaplica a etiqueta atual de um lead na conversa. */
router.post(
  '/labels/aplicar',
  asyncHandler(async (req, res) => {
    const lead = leadRepo.porId(req.body?.leadId);
    if (!lead) throw new AppError('Lead nao encontrado.', 404);
    res.json(await LabelService.aplicarNoLead(lead, lead.etiqueta));
  })
);

router.get(
  '/checar/:telefone',
  asyncHandler(async (req, res) => {
    const jid = await whatsapp.existeNoWhatsApp(req.params.telefone);
    res.json({ telefone: req.params.telefone, existe: Boolean(jid), jid });
  })
);

export default router;
