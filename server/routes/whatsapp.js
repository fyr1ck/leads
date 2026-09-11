import { Router } from 'express';
import whatsapp from '../services/whatsapp/WhatsAppService.js';
import { asyncHandler } from '../middleware/index.js';

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

router.get(
  '/checar/:telefone',
  asyncHandler(async (req, res) => {
    const jid = await whatsapp.existeNoWhatsApp(req.params.telefone);
    res.json({ telefone: req.params.telefone, existe: Boolean(jid), jid });
  })
);

export default router;
