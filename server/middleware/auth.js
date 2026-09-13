import AuthService from '../services/AuthService.js';
import { config } from '../config.js';


export const COOKIE = 'henvix_sessao';

/** Parser de cookie enxuto - evita mais uma dependencia so para ler um header. */
export function lerCookies(req, _res, next) {
  req.cookies = {};
  const bruto = req.headers.cookie;
  if (bruto) {
    for (const parte of bruto.split(';')) {
      const i = parte.indexOf('=');
      if (i < 0) continue;
      const nome = parte.slice(0, i).trim();
      try {
        req.cookies[nome] = decodeURIComponent(parte.slice(i + 1).trim());
      } catch {
        req.cookies[nome] = parte.slice(i + 1).trim();
      }
    }
  }
  next();
}

/** A requisicao veio da propria maquina onde o painel roda? */
/**
 * A requisicao veio de verdade da propria maquina?
 *
 * Nao basta olhar o IP: atras de Cloudflare Tunnel, Caddy ou nginx rodando na
 * mesma maquina, TODO visitante da internet chega pelo 127.0.0.1. Esses proxies
 * sempre acrescentam cabecalhos de encaminhamento - entao so e local quem vem
 * do loopback E sem nenhum desses cabecalhos.
 */
const CABECALHOS_DE_PROXY = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'cf-connecting-ip', 'true-client-ip', 'via'];

export function ehLocal(req) {
  const ip = String(req.socket?.remoteAddress || '');
  const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (!loopback) return false;
  return !CABECALHOS_DE_PROXY.some((h) => req.headers?.[h]);
}

export const tokenDaRequisicao = (req) =>
  req.cookies?.[COOKIE] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;

/** Coloca req.usuario quando houver sessao valida. Nao bloqueia. */
export function carregarUsuario(req, _res, next) {
  req.usuario = AuthService.validarToken(tokenDaRequisicao(req));
  next();
}

/** Rotas abertas: login, primeiro acesso e saude do sistema. */
const LIVRES = [/^\/auth\//, /^\/health$/];

export function exigirLogin(req, res, next) {
  if (!config.auth.exigirLogin) return next();
  if (LIVRES.some((re) => re.test(req.path))) return next();
  if (req.usuario) return next();
  return res.status(401).json({ erro: 'Faca login para usar o painel.', precisaLogin: true });
}

export function opcoesCookie(expira) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    /**
     * Em localhost (http) o cookie precisa de secure=false, senao o navegador
     * descarta. Publicado atras de HTTPS, ligue COOKIE_SEGURO=1 no .env para
     * o cookie nunca trafegar em conexao aberta.
     */
    secure: config.auth.cookieSeguro,
    path: '/',
    expires: expira ? new Date(expira) : undefined
  };
}
