/**
 * Zera a senha de um usuario autorizado. Na proxima vez que ele abrir o painel,
 * cria a senha de novo (primeiro acesso).
 *
 *   npm run auth:reset -- joao.jhcc31@gmail.com
 *
 * Existe porque o painel e local e nao tem "esqueci minha senha" por e-mail:
 * quem tem acesso a maquina resolve pelo terminal.
 */
import { migrar, get, run, all } from '../db/index.js';

migrar();

const email = String(process.argv[2] || '').trim().toLowerCase();

if (!email) {
  console.log('Use:  npm run auth:reset -- email@dominio.com\n');
  console.log('Usuarios cadastrados:');
  for (const u of all('SELECT email, ativo, senha_hash IS NOT NULL AS tem_senha, ultimo_acesso FROM users ORDER BY id')) {
    console.log(
      ` - ${u.email.padEnd(32)} ${u.ativo ? 'ativo' : 'inativo'} · ${u.tem_senha ? 'com senha' : 'sem senha'}` +
        (u.ultimo_acesso ? ` · ultimo acesso ${u.ultimo_acesso}` : '')
    );
  }
  process.exit(1);
}

const u = get('SELECT * FROM users WHERE email = ?', email);
if (!u) {
  console.error(`Usuario ${email} nao existe. Confira USUARIOS_PERMITIDOS no .env.`);
  process.exit(1);
}

run('UPDATE users SET senha_hash = NULL, senha_salt = NULL WHERE id = ?', u.id);
const sessoes = run('DELETE FROM sessions WHERE user_id = ?', u.id).changes;

console.log(`Senha de ${email} zerada. ${sessoes} sessao(oes) encerrada(s).`);
console.log('Abra o painel e crie a nova senha no primeiro acesso.');
