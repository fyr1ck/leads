import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { get, run } from '../../db/index.js';

/**
 * Guarda o estado da sessao do WhatsApp em duas camadas:
 *  - credenciais no disco (pasta multi-file do provider) -> sessao persistente,
 *    sem pedir QR Code novo a cada reinicio (spec 1.1);
 *  - status/numero no banco, para o painel saber o que mostrar.
 */
export const SESSION_ID = 1;

export const dir = config.whatsapp.sessionDir;

export function existeSessaoSalva() {
  try {
    const arquivos = fs.readdirSync(dir);
    return arquivos.some((f) => f.startsWith('creds'));
  } catch {
    return false;
  }
}

export function limparSessao() {
  try {
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  } catch {
    /* pasta pode nao existir ainda */
  }
  fs.mkdirSync(dir, { recursive: true });
}

export function lerEstado() {
  return (
    get('SELECT * FROM whatsapp_sessions WHERE id = ?', SESSION_ID) || {
      id: SESSION_ID,
      nome: 'principal',
      status: 'DESCONECTADO',
      numero: null
    }
  );
}

export function salvarEstado({ status, numero, push_name }) {
  run(
    `UPDATE whatsapp_sessions SET
       status = COALESCE(?, status),
       numero = COALESCE(?, numero),
       push_name = COALESCE(?, push_name),
       ultima_conexao = CASE WHEN ? = 'CONECTADO' THEN datetime('now') ELSE ultima_conexao END,
       desconectado_em = CASE WHEN ? = 'DESCONECTADO' THEN datetime('now') ELSE desconectado_em END,
       updated_at = datetime('now')
     WHERE id = ?`,
    status ?? null, numero ?? null, push_name ?? null, status ?? '', status ?? '', SESSION_ID
  );
  return lerEstado();
}
