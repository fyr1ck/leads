import { Router } from 'express';
import auth from './auth.js';
import leads from './leads.js';
import campaigns from './campaigns.js';
import conversations from './conversations.js';
import opportunities from './opportunities.js';
import whatsapp from './whatsapp.js';
import ai from './ai.js';
import prospect from './prospect.js';
import followups from './followups.js';
import demos from './demos.js';
import sales from './sales.js';
import reactivation from './reactivation.js';
import skill from './skill.js';
import meta from './meta.js';

const router = Router();

router.use('/auth', auth);
router.use('/leads', leads);
router.use('/campaigns', campaigns);
router.use('/conversations', conversations);
router.use('/opportunities', opportunities);
router.use('/whatsapp', whatsapp);
router.use('/ai', ai);
// --- v2: Sales OS ---
router.use('/prospect', prospect);
router.use('/followups', followups);
router.use('/demos', demos);
router.use('/sales', sales);
router.use('/reactivation', reactivation);
router.use('/skill', skill);
// meta fica por ultimo: ele registra rotas na raiz (/stats, /tags, /health...)
router.use('/', meta);

export default router;
