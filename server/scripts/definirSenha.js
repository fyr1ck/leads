/**
 * Define (ou troca) a senha de um usuario autorizado direto no servidor.
 *
 *   npm run auth:senha -- joao.jhcc31@gmail.com
 *
 * Feito para a VPS: la o painel e acessado pela internet, entao o "primeiro
 * acesso" pelo navegador fica bloqueado (senao qualquer um criaria a senha antes
 * do dono). Quem tem SSH na maquina e o dono - por isso a senha e criada aqui.
 *
 * A senha e digitada sem aparecer na tela e nunca vai para o historico do shell.
 */
import readline from 'node:readline';
import { migrar, get, run } from '../db/index.js';
import AuthService from '../services/AuthService.js';

migrar();
AuthService.semearUsuarios();

const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.log('Use:  npm run auth:senha -- email@dominio.com');
  process.exit(1);
}

const u = get('SELECT * FROM users WHERE email = ?', email);
if (!u) {
  console.error(`Usuario ${email} nao existe. Confira USUARIOS_PERMITIDOS no .env.`);
  process.exit(1);
}

// Uma interface so para as duas perguntas: duas instancias no mesmo stdin
// disputam o buffer e a segunda fica esperando para sempre.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
const linhas = rl[Symbol.asyncIterator]();
let mudo = false;
const escrever = rl._writeToOutput?.bind(rl);
if (escrever) rl._writeToOutput = (s) => !mudo && escrever(s); // o que e digitado nao aparece

async function perguntarOculto(texto) {
  process.stdout.write(texto);
  mudo = true;
  const { value } = await linhas.next();
  mudo = false;
  process.stdout.write('\n');
  return value ?? '';
}

const senha = await perguntarOculto('Nova senha: ');
const confirmacao = await perguntarOculto('Repita a senha: ');
rl.close();

if (senha !== confirmacao) {
  console.error('As senhas nao conferem. Nada foi alterado.');
  process.exit(1);
}

// zera a anterior (se houver) e cria a nova pelo mesmo caminho do painel
run('UPDATE users SET senha_hash = NULL, senha_salt = NULL WHERE id = ?', u.id);
try {
  await AuthService.definirSenha({ email, senha, local: true });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const sessoes = run('DELETE FROM sessions WHERE user_id = ?', u.id).changes;
console.log(`Senha de ${email} definida. ${sessoes} sessao(oes) antiga(s) encerrada(s).`);
