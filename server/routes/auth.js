import { Router } from 'express';
import AuthService from '../services/AuthService.js';
import { asyncHandler } from '../middleware/index.js';
import { COOKIE, ehLocal, opcoesCookie, tokenDaRequisicao } from '../middleware/auth.js';
import { AppError } from '../utils/errors.js';
import { config } from '../config.js';

const router = Router();

/** Quem esta logado + situacao dos usuarios (usado pela tela de login). */
router.get('/sessao', (req, res) => {
  res.json({
    logado: Boolean(req.usuario),
    usuario: req.usuario || null,
    exigirLogin: config.auth.exigirLogin,
    local: ehLocal(req),
    ...AuthService.estado()
  });
});

/** Consulta se o e-mail tem acesso e se ja tem senha. */
router.post('/situacao', (req, res) => {
  res.json(AuthService.situacao(req.body?.email));
});

/** Primeiro acesso: a pessoa cria a propria senha (so na maquina do painel). */
router.post(
  '/definir-senha',
  asyncHandler(async (req, res) => {
    const { email, senha } = req.body || {};
    await AuthService.definirSenha({ email, senha, local: ehLocal(req) });
    // ja entra direto depois de criar a senha
    const r = await AuthService.entrar({
      email,
      senha,
      userAgent: req.headers['user-agent'] || null,
      ip: req.ip
    });
    res.cookie(COOKIE, r.token, opcoesCookie(r.expira));
    res.json({ ok: true, usuario: r.usuario });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, senha } = req.body || {};
    if (!email || !senha) throw new AppError('Informe e-mail e senha.');
    const r = await AuthService.entrar({
      email,
      senha,
      userAgent: req.headers['user-agent'] || null,
      ip: req.ip
    });
    res.cookie(COOKIE, r.token, opcoesCookie(r.expira));
    res.json({ ok: true, usuario: r.usuario });
  })
);

router.post('/logout', (req, res) => {
  AuthService.sair(tokenDaRequisicao(req));
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

router.post(
  '/trocar-senha',
  asyncHandler(async (req, res) => {
    if (!req.usuario) throw new AppError('Faca login para trocar a senha.', 401);
    const { senhaAtual, novaSenha } = req.body || {};
    await AuthService.trocarSenha({ userId: req.usuario.id, senhaAtual, novaSenha });
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true, precisaEntrarDeNovo: true });
  })
);

export default router;
