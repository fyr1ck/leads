import crypto from 'node:crypto';
import { all, get, run } from '../db/index.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

/**
 * Acesso ao painel.
 *
 * Regras:
 *  - so entram os e-mails listados em USUARIOS_PERMITIDOS (.env);
 *  - a senha e definida pela propria pessoa no primeiro acesso - o sistema
 *    nunca gera nem guarda senha em texto;
 *  - a senha e derivada com scrypt + salt unico por usuario;
 *  - a sessao vive num cookie httpOnly, e no banco fica apenas o HASH do token.
 */
const DIAS_SESSAO = 30;
const MIN_SENHA = 8;

const normalizarEmail = (e) => String(e || '').trim().toLowerCase();

export const emailPermitido = (email) => config.auth.permitidos.includes(normalizarEmail(email));

/** Garante que cada e-mail autorizado exista como usuario (sem senha ainda). */
export function semearUsuarios() {
  for (const email of config.auth.permitidos) {
    run(
      `INSERT INTO users (email, nome) VALUES (?, ?)
       ON CONFLICT(email) DO UPDATE SET ativo = 1`,
      email,
      email.split('@')[0]
    );
  }
  // quem saiu da lista do .env perde o acesso, mas o registro fica no historico
  const permitidos = config.auth.permitidos;
  for (const u of all('SELECT id, email FROM users WHERE ativo = 1')) {
    if (!permitidos.includes(u.email)) {
      run('UPDATE users SET ativo = 0 WHERE id = ?', u.id);
      run('DELETE FROM sessions WHERE user_id = ?', u.id);
      logger.warn('auth', `${u.email} saiu da lista de autorizados e perdeu o acesso.`);
    }
  }
  return all('SELECT id, email, nome, ativo, senha_hash IS NOT NULL AS tem_senha FROM users ORDER BY id');
}

/* --------------------------------------------------------------- senha */

const derivar = (senha, salt) =>
  new Promise((resolve, reject) => {
    crypto.scrypt(String(senha), salt, 64, { N: 16384, r: 8, p: 1 }, (err, chave) =>
      err ? reject(err) : resolve(chave.toString('hex'))
    );
  });

const iguais = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export const porEmail = (email) => get('SELECT * FROM users WHERE email = ?', normalizarEmail(email));

/** O e-mail existe, esta liberado e ainda precisa criar senha? */
export function situacao(email) {
  const limpo = normalizarEmail(email);
  if (!emailPermitido(limpo)) return { permitido: false };
  const u = porEmail(limpo);
  return {
    permitido: true,
    existe: Boolean(u),
    precisaDefinirSenha: Boolean(u) && !u.senha_hash,
    ativo: u ? Boolean(u.ativo) : false
  };
}

/**
 * Primeiro acesso: a pessoa cria a propria senha.
 * So e aceito a partir da maquina onde o painel roda - assim ninguem de fora
 * "reivindica" a conta antes do dono, caso o painel seja exposto na rede.
 */
export async function definirSenha({ email, senha, local = false }) {
  const limpo = normalizarEmail(email);
  if (!emailPermitido(limpo)) throw new AppError('Esse e-mail nao tem acesso ao painel.', 403);
  if (!local) {
    throw new AppError('A senha do primeiro acesso so pode ser criada no computador onde o painel roda.', 403);
  }
  if (String(senha || '').length < MIN_SENHA) {
    throw new AppError(`A senha precisa ter pelo menos ${MIN_SENHA} caracteres.`);
  }

  const u = porEmail(limpo);
  if (!u) throw new AppError('Usuario nao encontrado.', 404);
  if (u.senha_hash) throw new AppError('Esse usuario ja tem senha. Use a troca de senha.', 409);

  const salt = crypto.randomBytes(16).toString('hex');
  run('UPDATE users SET senha_hash = ?, senha_salt = ? WHERE id = ?', await derivar(senha, salt), salt, u.id);
  logger.ok('auth', `Senha definida para ${limpo}.`);
  return { ok: true };
}

export async function trocarSenha({ userId, senhaAtual, novaSenha }) {
  const u = get('SELECT * FROM users WHERE id = ?', userId);
  if (!u) throw new AppError('Usuario nao encontrado.', 404);
  if (String(novaSenha || '').length < MIN_SENHA) {
    throw new AppError(`A nova senha precisa ter pelo menos ${MIN_SENHA} caracteres.`);
  }
  if (!iguais(await derivar(senhaAtual, u.senha_salt), u.senha_hash)) {
    throw new AppError('Senha atual incorreta.', 401);
  }
  const salt = crypto.randomBytes(16).toString('hex');
  run('UPDATE users SET senha_hash = ?, senha_salt = ? WHERE id = ?', await derivar(novaSenha, salt), salt, u.id);
  // troca de senha encerra as outras sessoes
  run('DELETE FROM sessions WHERE user_id = ?', u.id);
  logger.ok('auth', `${u.email} trocou a senha. Sessoes anteriores encerradas.`);
  return { ok: true };
}

/* ------------------------------------------------------------- tentativas */

const tentativas = new Map();
const JANELA_MS = 15 * 60_000;
const MAX_TENTATIVAS = 8;

function registrarFalha(chave) {
  const agora = Date.now();
  const atual = tentativas.get(chave)?.filter((t) => agora - t < JANELA_MS) || [];
  atual.push(agora);
  tentativas.set(chave, atual);
}

function bloqueado(chave) {
  const agora = Date.now();
  const atual = tentativas.get(chave)?.filter((t) => agora - t < JANELA_MS) || [];
  tentativas.set(chave, atual);
  return atual.length >= MAX_TENTATIVAS;
}

/* ---------------------------------------------------------------- sessao */

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export async function entrar({ email, senha, userAgent = null, ip = null }) {
  const limpo = normalizarEmail(email);
  const chave = `${limpo}|${ip || ''}`;

  if (bloqueado(chave)) {
    throw new AppError('Muitas tentativas. Aguarde alguns minutos e tente de novo.', 429);
  }
  if (!emailPermitido(limpo)) {
    registrarFalha(chave);
    throw new AppError('Esse e-mail nao tem acesso ao painel.', 403);
  }

  const u = porEmail(limpo);
  if (!u || !u.ativo) {
    registrarFalha(chave);
    throw new AppError('Usuario sem acesso.', 403);
  }
  if (!u.senha_hash) {
    throw new AppError('Primeiro acesso: crie sua senha antes de entrar.', 409);
  }
  if (!iguais(await derivar(senha, u.senha_salt), u.senha_hash)) {
    registrarFalha(chave);
    logger.warn('auth', `Tentativa de login sem sucesso para ${limpo}.`);
    throw new AppError('E-mail ou senha incorretos.', 401);
  }

  tentativas.delete(chave);

  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + DIAS_SESSAO * 86_400_000).toISOString();
  run(
    'INSERT INTO sessions (user_id, token_hash, user_agent, ip, expira_em) VALUES (?,?,?,?,?)',
    u.id,
    hashToken(token),
    userAgent,
    ip,
    expira
  );
  run("UPDATE users SET ultimo_acesso = datetime('now') WHERE id = ?", u.id);
  logger.ok('auth', `${limpo} entrou no painel.`);

  return { token, expira, usuario: publico(u) };
}

export function validarToken(token) {
  if (!token) return null;
  const s = get(
    `SELECT s.*, u.email, u.nome, u.ativo
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND datetime(s.expira_em) > datetime('now')`,
    hashToken(token)
  );
  if (!s || !s.ativo) return null;
  return { id: s.user_id, email: s.email, nome: s.nome, sessao_id: s.id };
}

export function sair(token) {
  if (!token) return false;
  return run('DELETE FROM sessions WHERE token_hash = ?', hashToken(token)).changes > 0;
}

export const limparSessoesExpiradas = () =>
  run("DELETE FROM sessions WHERE datetime(expira_em) <= datetime('now')").changes;

const publico = (u) => ({ id: u.id, email: u.email, nome: u.nome });

/** Situacao geral, usada pela tela de login. */
export function estado() {
  const usuarios = all(
    'SELECT email, nome, senha_hash IS NOT NULL AS tem_senha, ultimo_acesso FROM users WHERE ativo = 1 ORDER BY id'
  );
  return {
    permitidos: config.auth.permitidos,
    usuarios: usuarios.map((u) => ({
      email: u.email,
      nome: u.nome,
      precisaDefinirSenha: !u.tem_senha,
      ultimo_acesso: u.ultimo_acesso
    })),
    minimoSenha: MIN_SENHA
  };
}

export default {
  semearUsuarios, emailPermitido, situacao, definirSenha, trocarSenha,
  entrar, validarToken, sair, limparSessoesExpiradas, estado
};
