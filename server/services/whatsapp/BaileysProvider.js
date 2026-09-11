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
import { digitos, jidDeTelefone, telefoneDeJid, variantesBR } from '../../utils/phone.js';
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
    this.logger = pino({ level: process.env.BAILEYS_LOG || 'silent' });
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

        this.emit('mensagem', {
          telefone: telefoneDeJid(jid),
          jid,
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

  /** Descobre o JID real do numero (trata o nono digito). Retorna null se nao existir. */
  async existeNoWhatsApp(telefoneE164) {
    if (!this.sock || this.status !== 'CONECTADO') return null;
    const candidatos = variantesBR(telefoneE164);
    try {
      const resultados = await this.sock.onWhatsApp(...candidatos);
      const achado = (resultados || []).find((r) => r?.exists);
      return achado?.jid || null;
    } catch (err) {
      logger.debug('whatsapp', `onWhatsApp falhou para ${telefoneE164}: ${err.message}`);
      return null;
    }
  }

  async enviarTexto(telefoneE164, texto) {
    if (!this.sock || this.status !== 'CONECTADO') {
      throw new Error('WhatsApp not connected');
    }
    const jid = (await this.existeNoWhatsApp(telefoneE164)) || jidDeTelefone(telefoneE164);
    if (!digitos(telefoneE164)) throw new Error('Telefone invalido');

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
