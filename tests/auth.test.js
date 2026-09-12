/**
 * Acesso ao painel: so os e-mails autorizados entram, a senha e criada pela
 * propria pessoa e o hash nunca vira texto.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'henvix-auth-'));
process.env.DATABASE_URL = path.join(tmp, 'teste.db');
process.env.WA_SESSION_DIR = path.join(tmp, 'wa');
process.env.GROQ_API_KEY = '';
process.env.USUARIOS_PERMITIDOS = 'joao.jhcc31@gmail.com, castrinvini@gmail.com';

const { migrar, all, get } = await import('../server/db/index.js');
migrar();

const { default: AuthService } = await import('../server/services/AuthService.js');

const DONO = 'joao.jhcc31@gmail.com';
const SOCIO = 'castrinvini@gmail.com';
const INTRUSO = 'outra.pessoa@gmail.com';

test('so os dois e-mails autorizados viram usuario', () => {
  const usuarios = AuthService.semearUsuarios();
  const emails = usuarios.filter((u) => u.ativo).map((u) => u.email);
  assert.deepEqual(emails.sort(), [SOCIO, DONO].sort());
  assert.equal(AuthService.emailPermitido(DONO), true);
  assert.equal(AuthService.emailPermitido(SOCIO), true);
  assert.equal(AuthService.emailPermitido(INTRUSO), false);
  // maiuscula e espaco nao driblam a lista
  assert.equal(AuthService.emailPermitido('  JOAO.JHCC31@GMAIL.COM '), true);
});

test('e-mail de fora e recusado mesmo com senha', async () => {
  await assert.rejects(
    () => AuthService.definirSenha({ email: INTRUSO, senha: 'senhaqualquer1', local: true }),
    (e) => /nao tem acesso/i.test(e.message)
  );
  await assert.rejects(
    () => AuthService.entrar({ email: INTRUSO, senha: 'senhaqualquer1' }),
    (e) => /nao tem acesso/i.test(e.message)
  );
});

test('primeiro acesso so pode criar senha na maquina do painel', async () => {
  await assert.rejects(
    () => AuthService.definirSenha({ email: DONO, senha: 'umaSenhaBoa123', local: false }),
    (e) => /computador onde o painel roda/i.test(e.message)
  );
});

test('a pessoa cria a propria senha e a senha nunca fica em texto', async () => {
  const situacaoAntes = AuthService.situacao(DONO);
  assert.equal(situacaoAntes.precisaDefinirSenha, true);

  await AuthService.definirSenha({ email: DONO, senha: 'umaSenhaBoa123', local: true });

  const u = get('SELECT * FROM users WHERE email = ?', DONO);
  assert.ok(u.senha_hash && u.senha_salt, 'hash e salt sao gravados');
  assert.notEqual(u.senha_hash, 'umaSenhaBoa123');
  assert.ok(!JSON.stringify(u).includes('umaSenhaBoa123'), 'a senha nao aparece em lugar nenhum do registro');

  assert.equal(AuthService.situacao(DONO).precisaDefinirSenha, false);
});

test('senha curta e recusada', async () => {
  await assert.rejects(
    () => AuthService.definirSenha({ email: SOCIO, senha: '123', local: true }),
    (e) => /pelo menos/i.test(e.message)
  );
});

test('login valido cria sessao; senha errada nao', async () => {
  const r = await AuthService.entrar({ email: DONO, senha: 'umaSenhaBoa123', ip: '127.0.0.1' });
  assert.ok(r.token && r.token.length >= 40);
  assert.equal(r.usuario.email, DONO);

  // no banco fica so o hash do token
  const s = all('SELECT * FROM sessions')[0];
  assert.notEqual(s.token_hash, r.token);

  const valido = AuthService.validarToken(r.token);
  assert.equal(valido.email, DONO);
  assert.equal(AuthService.validarToken('token-inventado'), null);

  await assert.rejects(
    () => AuthService.entrar({ email: DONO, senha: 'senhaErrada!', ip: '127.0.0.1' }),
    (e) => /incorretos/i.test(e.message)
  );
});

test('logout invalida a sessao', async () => {
  const r = await AuthService.entrar({ email: DONO, senha: 'umaSenhaBoa123', ip: '127.0.0.1' });
  assert.ok(AuthService.validarToken(r.token));
  AuthService.sair(r.token);
  assert.equal(AuthService.validarToken(r.token), null);
});

test('excesso de tentativas bloqueia por um tempo', async () => {
  const ip = '10.0.0.9';
  for (let i = 0; i < 8; i += 1) {
    await AuthService.entrar({ email: DONO, senha: 'errada', ip }).catch(() => {});
  }
  await assert.rejects(
    () => AuthService.entrar({ email: DONO, senha: 'umaSenhaBoa123', ip }),
    (e) => /muitas tentativas/i.test(e.message)
  );
});

test('trocar a senha derruba as sessoes antigas', async () => {
  const r = await AuthService.entrar({ email: DONO, senha: 'umaSenhaBoa123', ip: '127.0.0.1' });
  const usuario = AuthService.validarToken(r.token);
  assert.ok(usuario);

  await AuthService.trocarSenha({ userId: usuario.id, senhaAtual: 'umaSenhaBoa123', novaSenha: 'outraSenhaBoa456' });
  assert.equal(AuthService.validarToken(r.token), null, 'a sessao antiga morre');

  const novo = await AuthService.entrar({ email: DONO, senha: 'outraSenhaBoa456', ip: '127.0.0.1' });
  assert.ok(novo.token);
});

test('tirar um e-mail da lista corta o acesso dele', async () => {
  const { config } = await import('../server/config.js');
  const original = [...config.auth.permitidos];

  const r = await AuthService.entrar({ email: DONO, senha: 'outraSenhaBoa456', ip: '127.0.0.1' });
  assert.ok(AuthService.validarToken(r.token));

  config.auth.permitidos = [SOCIO]; // simula alteracao do .env
  AuthService.semearUsuarios();

  assert.equal(AuthService.validarToken(r.token), null, 'a sessao cai junto');
  await assert.rejects(() => AuthService.entrar({ email: DONO, senha: 'outraSenhaBoa456' }));

  config.auth.permitidos = original;
  AuthService.semearUsuarios();
});

test.after(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* windows pode segurar o arquivo do banco */
  }
});
