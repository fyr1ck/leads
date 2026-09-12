import { EventEmitter } from 'node:events';
import { BaileysProvider } from './BaileysProvider.js';
import * as sessionStore from './SessionStore.js';
import { bus, EVENTOS } from '../../realtime/bus.js';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../utils/errors.js';

/**
 * Fachada unica do WhatsApp usada pelo resto do sistema (spec 4).
 * Nenhuma rota, servico ou pagina importa Baileys diretamente.
 */
export class WhatsAppService extends EventEmitter {
  constructor(provider = new BaileysProvider()) {
    super();
    this.provider = provider;
    this.qr = null;
    this.motivo = null;
    this._ligarProvider();
  }

  /**
   * Troca a biblioteca de WhatsApp em tempo de execucao (spec 4).
   * Basta que o novo provider implemente iniciar/encerrar/enviarTexto/
   * existeNoWhatsApp e emita status/qr/mensagem. O painel nao muda.
   */
  trocarProvider(provider) {
    this.provider?.removeAllListeners?.();
    this.provider = provider;
    this.qr = null;
    this._ligarProvider();
    return this.estado();
  }

  _ligarProvider() {
    this.provider.on('status', ({ status, numero, pushName, motivo }) => {
      this.motivo = motivo || null;
      sessionStore.salvarEstado({ status, numero, push_name: pushName });
      if (status !== 'QRCODE') this.qr = status === 'CONECTADO' ? null : this.qr;
      if (status === 'CONECTADO' || status === 'DESCONECTADO') this.qr = null;
      const payload = this.estado();
      bus.emit(EVENTOS.WHATSAPP_STATUS, payload);
      this.emit('status', payload);
    });

    this.provider.on('qr', (dataUrl) => {
      this.qr = dataUrl;
      const payload = this.estado();
      bus.emit(EVENTOS.WHATSAPP_QR, payload);
      bus.emit(EVENTOS.WHATSAPP_STATUS, payload);
    });

    // Mensagens recebidas sao apenas repassadas. Quem decide o que fazer e o
    // InboundHandler - e ele NUNCA responde (spec 15 / 50).
    this.provider.on('mensagem', (msg) => this.emit('mensagem', msg));

    this.provider.on('etiquetas', (lista) => this.emit('etiquetas', lista));
  }

  estado() {
    const salvo = sessionStore.lerEstado();
    return {
      status: this.provider.status,
      conectado: this.provider.status === 'CONECTADO',
      numero: this.provider.numero || salvo.numero || null,
      pushName: this.provider.pushName || salvo.push_name || null,
      qr: this.qr,
      motivo: this.motivo,
      provider: this.provider.nome,
      sessaoSalva: sessionStore.existeSessaoSalva(),
      ultimaConexao: salvo.ultima_conexao || null,
      desconectadoEm: salvo.desconectado_em || null
    };
  }

  get conectado() {
    return this.provider.status === 'CONECTADO';
  }

  async conectar() {
    if (this.conectado) return this.estado();
    await this.provider.iniciar();
    return this.estado();
  }

  async desconectar({ logout = true } = {}) {
    await this.provider.encerrar({ logout });
    return this.estado();
  }

  /** Reconectar = derrubar a sessao atual e subir de novo mantendo as credenciais. */
  async reconectar() {
    await this.provider.encerrar({ logout: false });
    await new Promise((r) => setTimeout(r, 800));
    await this.provider.iniciar();
    return this.estado();
  }

  /** Sobe sozinho no boot quando ja existe sessao salva (spec 1.1). */
  async iniciarSeTiverSessao() {
    if (!sessionStore.existeSessaoSalva()) {
      logger.info('whatsapp', 'Nenhuma sessao salva. Conecte pelo painel para gerar o QR Code.');
      sessionStore.salvarEstado({ status: 'DESCONECTADO' });
      return this.estado();
    }
    logger.info('whatsapp', 'Sessao salva encontrada. Restaurando conexao...');
    try {
      await this.provider.iniciar();
    } catch (err) {
      logger.erro('whatsapp', `Nao foi possivel restaurar a sessao: ${err.message}`);
    }
    return this.estado();
  }

  async enviarTexto(telefoneE164, texto) {
    if (!this.conectado) throw new AppError('WhatsApp not connected', 409);
    return this.provider.enviarTexto(telefoneE164, texto);
  }

  async existeNoWhatsApp(telefoneE164) {
    return this.provider.existeNoWhatsApp(telefoneE164);
  }

  /* ------------------------------------------------ etiquetas do WhatsApp */

  /** O provider atual sabe mexer em etiqueta? (recurso do WhatsApp Business) */
  get suportaEtiquetas() {
    return Boolean(this.provider?.suportaEtiquetas && typeof this.provider.criarEtiqueta === 'function');
  }

  listarEtiquetasWhatsApp() {
    return this.provider?.listarEtiquetas?.() || [];
  }

  async criarEtiqueta(dados) {
    if (!this.suportaEtiquetas) throw new AppError('A biblioteca de WhatsApp em uso nao suporta etiquetas.', 501);
    if (!this.conectado) throw new AppError('WhatsApp not connected', 409);
    return this.provider.criarEtiqueta(dados);
  }

  async aplicarEtiquetaNoChat(telefoneE164, labelId) {
    if (!this.suportaEtiquetas || !this.conectado) return false;
    const jid = (await this.existeNoWhatsApp(telefoneE164)) || `${String(telefoneE164).replace(/\D/g, '')}@s.whatsapp.net`;
    await this.provider.aplicarEtiquetaNoChat(jid, labelId);
    return true;
  }

  async removerEtiquetaDoChat(telefoneE164, labelId) {
    if (!this.suportaEtiquetas || !this.conectado) return false;
    const jid = (await this.existeNoWhatsApp(telefoneE164)) || `${String(telefoneE164).replace(/\D/g, '')}@s.whatsapp.net`;
    await this.provider.removerEtiquetaDoChat(jid, labelId);
    return true;
  }
}

export const whatsappService = new WhatsAppService();
export default whatsappService;
