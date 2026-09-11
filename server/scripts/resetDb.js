/**
 * Recria o banco local do zero. Use com cuidado: apaga leads, mensagens e
 * historico. A sessao do WhatsApp NAO e afetada.
 *
 *   npm run db:reset -- --sim
 */
import fs from 'node:fs';
import { paths } from '../config.js';

const confirmado = process.argv.includes('--sim');

if (!confirmado) {
  console.log('Isso vai APAGAR o banco em:', paths.db);
  console.log('Rode de novo com:  npm run db:reset -- --sim');
  process.exit(1);
}

for (const sufixo of ['', '-wal', '-shm']) {
  const arquivo = `${paths.db}${sufixo}`;
  if (fs.existsSync(arquivo)) {
    fs.rmSync(arquivo);
    console.log('removido:', arquivo);
  }
}

const { migrar } = await import('../db/index.js');
migrar();
console.log('Banco recriado com o schema atual.');
