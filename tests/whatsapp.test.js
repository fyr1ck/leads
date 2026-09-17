/**
 * BaileysProvider com um socket simulado.
 *
 * Garante o que causava mensagem "enviada" que nunca chegava: o WhatsApp aceita
 * mensagem para numero inexistente sem erro. O provider nao pode mais enviar
 * para numero chutado, e precisa tratar LID (xxx@lid) como endereco, nao telefone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'henvix-wa-'));
process.env.DATABASE_URL = path.join(tmp, 'teste.db');
process.env.WA_SESSION_DIR = path.join(tmp, 'wa');

const { BaileysProvider } = await import('../server/services/whatsapp/BaileysProvider.js');

function providerCom({ onWhatsApp }) {
  const p = new BaileysProvider();
  const enviadas = [];
  p.status = 'CONECTADO';
  p.sock = {
    onWhatsApp,
    presenceSubscribe: async () => {},
    sendPresenceUpdate: async () => {},
    sendMessage: async (jid, conteudo) => {
      enviadas.push({ jid, texto: conteudo.text });
      return { key: { id: `msg-${enviadas.length}` } };
    }
  };
  return { p, enviadas };
}

test('numero que nao existe no WhatsApp: erro visivel e NADA e enviado', async () => {
  const { p, enviadas } = providerCom({ onWhatsApp: async () => [{ exists: false }] });
  await assert.rejects(() => p.enviarTexto('5516900000000', 'oi'), /nao esta no WhatsApp/i);
  assert.equal(enviadas.length, 0);
});

test('consulta ao WhatsApp falhou: nao manda para um numero chutado', async () => {
  const { p, enviadas } = providerCom({
    onWhatsApp: async () => {
      throw new Error('timed out');
    }
  });
  await assert.rejects(() => p.enviarTexto('5516900000000', 'oi'), /Nao consegui confirmar/i);
  assert.equal(enviadas.length, 0);
});

test('telefone confirmado: envia para o JID que o WhatsApp devolveu (nono digito)', async () => {
  const { p, enviadas } = providerCom({
    onWhatsApp: async () => [{ exists: false }, { exists: true, jid: '551691234567@s.whatsapp.net' }]
  });
  const r = await p.enviarTexto('5516991234567', 'oi');
  assert.equal(enviadas[0].jid, '551691234567@s.whatsapp.net');
  assert.equal(r.jid, '551691234567@s.whatsapp.net');
});

test('consulta do numero avisa o LID devolvido pelo WhatsApp', async () => {
  const { p } = providerCom({
    onWhatsApp: async () => [{ exists: true, jid: '5516991234567@s.whatsapp.net', lid: '264514553557138' }]
  });
  const avisos = [];
  p.on('numeroCompartilhado', (d) => avisos.push(d));
  await p.consultarNumero('5516991234567');
  assert.deepEqual(avisos, [{ lid: '264514553557138@lid', telefone: '5516991234567' }]);
});

test('endereco de conversa (LID) vai direto, sem consultar numero', async () => {
  let consultou = false;
  const { p, enviadas } = providerCom({
    onWhatsApp: async () => {
      consultou = true;
      return [];
    }
  });
  await p.enviarTexto('264514553557138@lid', 'oi');
  assert.equal(consultou, false);
  assert.equal(enviadas[0].jid, '264514553557138@lid');
});

test('mensagem recebida por LID nao vira telefone falso', () => {
  const p = new BaileysProvider();
  const recebidas = [];
  p.on('mensagem', (m) => recebidas.push(m));

  p._onMessages({
    type: 'notify',
    messages: [
      { key: { remoteJid: '264514553557138@lid', id: 'a' }, message: { conversation: 'oi' }, pushName: 'Rick' },
      { key: { remoteJid: '998877665544332@lid', senderPn: '5516997771234@s.whatsapp.net', id: 'b' }, message: { conversation: 'quero' } },
      { key: { remoteJid: '5516991112222@s.whatsapp.net', id: 'c' }, message: { conversation: 'ola' } }
    ]
  });

  assert.equal(recebidas[0].telefone, null, 'LID sem numero informado: telefone desconhecido');
  assert.equal(recebidas[0].lid, '264514553557138@lid');
  assert.equal(recebidas[1].telefone, '5516997771234', 'LID com senderPn: usa o numero real');
  assert.equal(recebidas[2].telefone, '5516991112222');
  assert.equal(recebidas[2].lid, null);
});

test.after(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* windows pode segurar o arquivo do banco */
  }
});
