import { EventEmitter } from 'node:events';
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  Browsers,
  isJidBroadcast,
  isJidStatusBroadcast
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { digitos, telefoneDeJid, variantesBR } from '../../utils/phone.js';

const ehLid = (jid) => String(jid || '').endsWith('@lid');
import * as sessionStore from './SessionStore.js';

/**
 * Adapter do WhatsApp Web (Baileys).
 *
 * Toda dependencia da biblioteca vive AQUI. O resto do sistema conversa apenas
 * com o WhatsAppService, entao trocar de biblioteca no futuro significa escrever
 * outro provider com estes mesmos metodos/eventos - sem tocar no painel (spec 4).
 *
 * Contrato do provider:
 *   iniciar()                        -> inicia a sessao (emite 'qr' quando precisa)
 *   encerrar({ logout })             -> derruba a sessao
 *   enviarTexto(telefone, texto)     -> { waId, jid }
 *   existeNoWhatsApp(telefone)       -> jid | null
 * Eventos: 'qr' (dataURL), 'status' ({status, numero, motivo}), 'mensagem'
 */
export class BaileysProvider extends EventEmitter {
  constructor() {
    super();
    this.nome = 'baileys';
    this.sock = null;
    this.status = 'DESCONECTADO';
    this.numero = null;
    this.pushName = null;
    this.qr = null;
    this.encerrandoManual = false;
    this.iniciando = false;
    this.tentativas = 0;
    // Etiquetas do WhatsApp Business conhecidas nesta sessao (id -> {id, nome, cor})
    this.etiquetas = new Map();
    this.suportaEtiquetas = true;
    this.logger = pino({ level: process.env.BAILEYS_LOG || 'silent' });
  }

  listarEtiquetas() {
    return [...this.etiquetas.values()];
  }

  /**
   * Cria ou renomeia uma etiqueta no WhatsApp (recurso do WhatsApp Business).
   * Vai como app-state patch, entao aparece no celular tambem.
   */
  async criarEtiqueta({ id, nome, cor = 0 }) {
    if (!this.sock || this.status !== 'CONECTADO') throw new Error('WhatsApp not connected');
    const meuJid = this.sock.user?.id;
    await this.sock.addLabel(meuJid, { id: String(id), name: nome, color: Number(cor) || 0, deleted: false });
    this.etiquetas.set(String(id), { id: String(id), nome, cor });
    return { id: String(id), nome, cor };
  }

  async aplicarEtiquetaNoChat(jid, labelId) {
    if (!this.sock || this.status !== 'CONECTADO') throw new Error('WhatsApp not connected');
    await this.sock.addChatLabel(jid, String(labelId));
  }

  async removerEtiquetaDoChat(jid, labelId) {
    if (!this.sock || this.status !== 'CONECTADO') throw new Error('WhatsApp not connected');
    await this.sock.removeChatLabel(jid, String(labelId));
  }

  _status(status, extra = {}) {
    this.status = status;
    this.emit('status', { status, numero: this.numero, pushName: this.pushName, ...extra });
  }

  async iniciar() {
    if (this.iniciando) return;
    if (this.sock && this.status === 'CONECTADO') return;
    this.iniciando = true;
    this.encerrandoManual = false;

    try {
      const { state, saveCreds } = await useMultiFileAuthState(config.whatsapp.sessionDir);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));

      this._status('CONECTANDO');

      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger)
        },
        logger: this.logger,
        printQRInTerminal: false,
        browser: Browsers.appropriate(config.whatsapp.deviceName),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        // Nao respondemos ninguem automaticamente: nao precisamos processar
        // nada alem do texto recebido.
        shouldIgnoreJid: (jid) => isJidBroadcast(jid) || isJidStatusBroadcast(jid)
      });

      this.sock.ev.on('creds.update', saveCreds);
      this.sock.ev.on('connection.update', (u) => this._onConnectionUpdate(u));
      this.sock.ev.on('messages.upsert', (u) => this._onMessages(u));

      // Quando o WhatsApp revela o numero real por tras de um LID.
      this.sock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => {
        const telefone = jid ? telefoneDeJid(jid) : null;
        if (lid && telefone) this.emit('numeroCompartilhado', { lid, telefone });
      });

      // Etiquetas que ja existem no aparelho chegam pelo app-state.
      this.sock.ev.on('labels.edit', (label) => {
        if (!label?.id) return;
        if (label.deleted) this.etiquetas.delete(String(label.id));
        else this.etiquetas.set(String(label.id), { id: String(label.id), nome: label.name, cor: label.color });
        this.emit('etiquetas', this.listarEtiquetas());
      });
    } catch (err) {
      logger.erro('whatsapp', `Falha ao iniciar sessao: ${err.message}`);
      this._status('DESCONECTADO', { motivo: err.message });
      throw err;
    } finally {
      this.iniciando = false;
    }
  }

  async _onConnectionUpdate({ connection, lastDisconnect, qr }) {
    if (qr) {
      try {
        this.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320, color: { dark: '#020617', light: '#ffffff' } });
        this._status('QRCODE');
        this.emit('qr', this.qr);
        logger.info('whatsapp', 'QR Code gerado - escaneie pelo painel para conectar.');
      } catch (err) {
        logger.erro('whatsapp', `Nao foi possivel gerar o QR Code: ${err.message}`);
      }
    }

    if (connection === 'open') {
      this.qr = null;
      this.tentativas = 0;
      this.numero = telefoneDeJid(this.sock?.user?.id || '');
      this.pushName = this.sock?.user?.name || null;
      this._status('CONECTADO');
      logger.ok('whatsapp', `Conectado como ${this.pushName || 'dispositivo'} (${this.numero || 'numero indisponivel'}).`);
    }

    if (connection === 'close') {
      const codigo = lastDisconnect?.error?.output?.statusCode ?? lastDisconnect?.error?.output?.payload?.statusCode;
      const deslogado = codigo === DisconnectReason.loggedOut;
      this.qr = null;

      if (deslogado) {
        sessionStore.limparSessao();
        this.numero = null;
        this.pushName = null;
        this._status('DESCONECTADO', { motivo: 'Sessao encerrada no celular. Escaneie o QR Code novamente.' });
        logger.warn('whatsapp', 'Sessao encerrada pelo celular. Novo QR Code sera necessario.');
        return;
      }

      if (this.encerrandoManual) {
        this._status('DESCONECTADO', { motivo: 'Desconectado pelo painel.' });
        return;
      }

      // 440 = a sessao foi assumida por outra instancia. Reconectar aqui cria
      // um cabo de guerra: as duas se derrubam em looping. Melhor parar e avisar.
      if (codigo === DisconnectReason.connectionReplaced) {
        this.sock = null;
        this._status('DESCONECTADO', {
          motivo: 'Outra instancia do painel assumiu esta sessao do WhatsApp. Feche a outra janela/servidor e clique em Conectar.'
        });
        logger.erro(
          'whatsapp',
          'Sessao assumida por outra instancia (440). Rode apenas UM servidor por vez - reconectar aqui criaria um looping.'
        );
        return;
      }

      // 515 = o WhatsApp pede restart do socket logo apos o pareamento.
      if (codigo === DisconnectReason.restartRequired) {
        logger.info('whatsapp', 'O WhatsApp pediu para reiniciar a conexao. Reabrindo...');
        setTimeout(() => this.iniciar().catch(() => {}), 500);
        return;
      }

      this.tentativas += 1;
      const espera = Math.min(30_000, 2000 * this.tentativas);
      this._status('CONECTANDO', { motivo: `Reconectando em ${Math.round(espera / 1000)}s...` });
      logger.warn('whatsapp', `Conexao caiu (codigo ${codigo ?? 'desconhecido'}). Tentando reconectar em ${Math.round(espera / 1000)}s.`);
      setTimeout(() => {
        if (!this.encerrandoManual) this.iniciar().catch(() => {});
      }, espera);
    }
  }

  _extrairTexto(msg) {
    const m = msg.message || {};
    return (
      m.conversation ||
      m.extendedTextMessage?.text ||
      m.imageMessage?.caption ||
      m.videoMessage?.caption ||
      m.documentMessage?.caption ||
      m.buttonsResponseMessage?.selectedDisplayText ||
      m.listResponseMessage?.title ||
      m.templateButtonReplyMessage?.selectedDisplayText ||
      ''
    );
  }

  _onMessages({ messages, type }) {
    if (type !== 'notify') return; // historico antigo nao vira "resposta nova"
    for (const msg of messages || []) {
      try {
        const jid = msg.key?.remoteJid || '';
        if (!jid || jid.endsWith('@g.us') || isJidBroadcast(jid) || isJidStatusBroadcast(jid)) continue;
        if (msg.key?.fromMe) continue; // eco das nossas proprias mensagens
        const texto = this._extrairTexto(msg);
        if (!texto || !String(texto).trim()) continue;

        // O WhatsApp esta trocando o numero por um LID (id interno, "xxx@lid")
        // em parte das conversas. Os digitos de um LID NAO sao telefone: tratar
        // como telefone faz a resposta ir para um numero que nao existe e sumir
        // sem erro. O numero real, quando o WhatsApp informa, vem em senderPn.
        const lid = ehLid(jid) ? jid : null;
        const telefone = lid ? (msg.key?.senderPn ? telefoneDeJid(msg.key.senderPn) : null) : telefoneDeJid(jid);

        this.emit('mensagem', {
          telefone,
          jid,
          lid,
          texto: String(texto).trim(),
          waId: msg.key?.id || null,
          pushName: msg.pushName || null,
          timestamp: Number(msg.messageTimestamp || 0) * 1000 || Date.now()
        });
      } catch (err) {
        logger.erro('whatsapp', `Erro ao processar mensagem recebida: ${err.message}`);
      }
    }
  }

  /**
   * Consulta o numero no WhatsApp (trata o nono digito).
   * Retorna o JID se existir, null se nao existir, e LANCA se a consulta falhar -
   * "nao sei" nao pode virar "manda assim mesmo".
   */
  async consultarNumero(telefoneE164) {
    if (!this.sock || this.status !== 'CONECTADO') throw new Error('WhatsApp not connected');
    const resultados = await this.sock.onWhatsApp(...variantesBR(telefoneE164));
    const achado = (resultados || []).find((r) => r?.exists);
    // A consulta tambem devolve o LID. Guardar agora e o que permite reconhecer
    // a resposta que chega so por LID, sem o numero junto.
    if (achado?.lid) {
      const lid = String(achado.lid).includes('@') ? String(achado.lid) : `${achado.lid}@lid`;
      this.emit('numeroCompartilhado', { lid, telefone: telefoneE164 });
    }
    return achado?.jid || null;
  }

  /** Versao tolerante (usada em consultas informativas): falha vira null. */
  async existeNoWhatsApp(telefoneE164) {
    try {
      return await this.consultarNumero(telefoneE164);
    } catch (err) {
      logger.debug('whatsapp', `onWhatsApp falhou para ${telefoneE164}: ${err.message}`);
      return null;
    }
  }

  /**
   * Envia texto para um telefone OU para o endereco exato de uma conversa
   * ("xxx@s.whatsapp.net" / "xxx@lid").
   *
   * Nunca envia para um numero "chutado": o WhatsApp aceita mensagem para numero
   * inexistente sem dar erro e ela simplesmente nao chega - o painel mostraria
   * "enviada" para algo que ninguem recebeu.
   */
  async enviarTexto(destino, texto) {
    if (!this.sock || this.status !== 'CONECTADO') {
      throw new Error('WhatsApp not connected');
    }

    let jid;
    if (String(destino || '').includes('@')) {
      jid = destino;
    } else {
      if (!digitos(destino)) throw new Error('Telefone invalido');
      try {
        jid = await this.consultarNumero(destino);
      } catch (err) {
        throw new Error(`Nao consegui confirmar o numero no WhatsApp (${err.message}). Nada foi enviado.`);
      }
      if (!jid) throw new Error('Esse numero nao esta no WhatsApp. Nada foi enviado.');
    }

    // Indicador de digitacao: comportamento normal de um cliente do WhatsApp.
    try {
      await this.sock.presenceSubscribe(jid);
      await this.sock.sendPresenceUpdate('composing', jid);
      await new Promise((r) => setTimeout(r, Math.min(4000, 600 + texto.length * 12)));
      await this.sock.sendPresenceUpdate('paused', jid);
    } catch {
      /* presenca e opcional */
    }

    const enviado = await this.sock.sendMessage(jid, { text: texto });
    return { waId: enviado?.key?.id || null, jid };
  }

  async encerrar({ logout = false } = {}) {
    this.encerrandoManual = true;
    try {
      if (this.sock) {
        if (logout) await this.sock.logout().catch(() => {});
        else this.sock.end?.(undefined);
      }
    } finally {
      this.sock = null;
      this.qr = null;
      if (logout) {
        sessionStore.limparSessao();
        this.numero = null;
        this.pushName = null;
      }
      this._status('DESCONECTADO', { motivo: logout ? 'Sessao removida.' : 'Desconectado pelo painel.' });
    }
  }
}
