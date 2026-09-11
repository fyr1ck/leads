import { Router } from 'express';
import leads from './leads.js';
import campaigns from './campaigns.js';
import conversations from './conversations.js';
import opportunities from './opportunities.js';
import whatsapp from './whatsapp.js';
import ai from './ai.js';
import meta from './meta.js';

const router = Router();

router.use('/leads', leads);
router.use('/campaigns', campaigns);
router.use('/conversations', conversations);
router.use('/opportunities', opportunities);
router.use('/whatsapp', whatsapp);
router.use('/ai', ai);
router.use('/', meta);

export default router;
