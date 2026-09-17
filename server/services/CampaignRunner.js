import whatsapp from './whatsapp/WhatsAppService.js';
import MessageService from './MessageService.js';
import AIService from './ai/AIService.js';
import FollowUpService from './FollowUpService.js';
import * as campaignRepo from '../repositories/campaignRepo.js';
import * as leadRepo from '../repositories/leadRepo.js';
import * as messageRepo from '../repositories/messageRepo.js';
import * as settingsRepo from '../repositories/settingsRepo.js';
import { bus, EVENTOS } from '../realtime/bus.js';
import { logger } from '../utils/logger.js';
import { AppError, mensagemAmigavel } from '../utils/errors.js';
import { criarSinal, esperaCancelavel, delayAleatorio, faixaSegura } from '../utils/delay.js';
import { temJanela, msAteAbrir } from '../utils/horario.js';

/**
 * Motor da prospeccao (spec 9 / 13 / 14 / 44 / 54).
 *
 * Garantias:
 *  - fila persistente no banco (sobrevive a restart);
 *  - delay aleatorio dentro da faixa configurada, nunca fixo;
 *  - pausa entre blocos configuravel;
 *  - pausa automatica se o WhatsApp cair ou der erro em sequencia;
 *  - nunca envia duas vezes para o mesmo telefone;
 *  - com horario definido (ex.: 08:00-18:00), so envia dentro dele: fora da
 *    janela espera sozinha e retoma no proximo inicio ate a fila acabar.
 */
class CampaignRunner {
  constructor() {
    this.execucoes = new Map();
    this.monitorLigado = false;
    // campanhas com horario que estavam rodando quando o servidor reiniciou
    this.retomarAoConectar = new Set();
  }

  _exec(id) {
    const chave = Number(id);
    if (!this.execucoes.has(chave)) {
      this.execucoes.set(chave, {
        sinal: criarSinal(),
        rodando: false,
        enviadosNoBloco: 0,
        errosConsecutivos: 0,
        atual: null,
        proximoEnvioEm: null,
        pausaBlocoAte: null,
        fase: 'parado'
      });
    }
    return this.execucoes.get(chave);
  }

  /** Pausa automatica quando o WhatsApp desconecta (spec 44). */
  monitorarConexao() {
    if (this.monitorLigado) return;
    this.monitorLigado = true;
    whatsapp.on('status', ({ conectado }) => {
      if (conectado) {
        this._retomarAgendadas();
        return;
      }
      for (const [id, exec] of this.execucoes) {
        // esperando o horario de inicio nao envia nada: confere a conexao quando abrir
        if (exec.rodando && exec.fase !== 'fora_horario') {
          this.pausar(id, 'WhatsApp desconectado. A campanha foi pausada para evitar novos envios.', {
            automatico: true
          });
        }
      }
    });
  }

  /**
   * Campanha que ficou "ATIVA" num restart volta como PAUSADA.
   * Excecao: a que tem horario automatico - o operador pediu para ela comecar
   * sozinha, entao retoma assim que o WhatsApp reconectar.
   */
  restaurarNoBoot() {
    for (const c of campaignRepo.ativas()) {
      if (c.status !== 'ATIVA') continue;
      if (temJanela(c.horario_inicio, c.horario_fim)) {
        campaignRepo.atualizar(c.id, {
          status: 'PAUSADA',
          motivo_parada: `O servidor foi reiniciado. Ela retoma sozinha quando o WhatsApp conectar (horario ${c.horario_inicio}-${c.horario_fim}).`
        });
        this.retomarAoConectar.add(Number(c.id));
        logger.warn('campanha', `Campanha "${c.nome}" retoma sozinha quando o WhatsApp conectar.`);
        continue;
      }
      campaignRepo.atualizar(c.id, {
        status: 'PAUSADA',
        motivo_parada: 'O servidor foi reiniciado. Clique em CONTINUAR para retomar.'
      });
      logger.warn('campanha', `Campanha "${c.nome}" estava ativa no desligamento e voltou como PAUSADA.`);
    }
    if (whatsapp.conectado) this._retomarAgendadas();
  }

  _retomarAgendadas() {
    for (const id of [...this.retomarAoConectar]) {
      this.retomarAoConectar.delete(id);
      const c = campaignRepo.porId(id);
      if (!c || c.status !== 'PAUSADA') continue;
      this.iniciar(id).catch((err) =>
        logger.warn('campanha', `Nao consegui retomar "${c.nome}" sozinha: ${mensagemAmigavel(err)}`)
      );
    }
  }

  estado(id) {
    const progresso = campaignRepo.progresso(id);
    if (!progresso) return null;
    const exec = this._exec(id);
    return {
      ...progresso,
      rodando: exec.rodando,
      fase: exec.fase,
      atual: exec.atual,
      proximoEnvioEm: exec.proximoEnvioEm,
      pausaBlocoAte: exec.pausaBlocoAte,
      errosConsecutivos: exec.errosConsecutivos
    };
  }

  _emitir(id, extra = {}) {
    const estado = this.estado(id);
    if (!estado) return;
    bus.emit(EVENTOS.CAMPANHA_PROGRESSO, { ...estado, ...extra });
  }

  async iniciar(id) {
    const campanha = campaignRepo.porId(id);
    if (!campanha) throw new AppError('Campanha nao encontrada.', 404);
    if (campanha.status === 'CONCLUIDA') throw new AppError('Essa campanha ja foi concluida.', 409);

    const exec = this._exec(id);
    if (exec.rodando) return this.estado(id);

    if (!whatsapp.conectado) {
      throw new AppError('Conecte o WhatsApp antes de iniciar a prospeccao.', 409);
    }
    const progresso = campaignRepo.progresso(id);
    if (!progresso || progresso.pendentes === 0) {
      throw new AppError('Nao ha leads pendentes nessa campanha.', 409);
    }

    exec.sinal.reset();
    exec.rodando = true;
    exec.errosConsecutivos = 0;
    exec.fase = 'enviando';

    this.retomarAoConectar.delete(Number(id));
    campaignRepo.atualizar(id, {
      status: 'ATIVA',
      motivo_parada: null,
      started_at: campanha.started_at || new Date().toISOString()
    });
    const janela = temJanela(campanha.horario_inicio, campanha.horario_fim)
      ? ` Horario de envio: ${campanha.horario_inicio} as ${campanha.horario_fim}.`
      : '';
    logger.ok('campanha', `Campanha "${campanha.nome}" iniciada (${progresso.pendentes} leads na fila).${janela}`);
    bus.emit(EVENTOS.CAMPANHA_STATUS, { id: Number(id), status: 'ATIVA' });
    this._emitir(id);

    this._loop(id).catch((err) => {
      logger.erro('campanha', `Erro inesperado no motor da campanha: ${err.message}`);
      this.pausar(id, mensagemAmigavel(err), { automatico: true });
    });

    return this.estado(id);
  }

  pausar(id, motivo = 'Pausada pelo operador.', { automatico = false } = {}) {
    const exec = this._exec(id);
    if (!automatico) this.retomarAoConectar.delete(Number(id));
    exec.sinal.cancelar();
    exec.rodando = false;
    exec.fase = 'pausado';
    exec.proximoEnvioEm = null;
    exec.pausaBlocoAte = null;
    const campanha = campaignRepo.porId(id);
    if (campanha && campanha.status === 'ATIVA') {
      campaignRepo.atualizar(id, { status: 'PAUSADA', motivo_parada: motivo });
    }
    logger[automatico ? 'warn' : 'info']('campanha', `Campanha pausada: ${motivo}`);
    bus.emit(EVENTOS.CAMPANHA_STATUS, { id: Number(id), status: 'PAUSADA', motivo, automatico });
    if (automatico) {
      bus.emit(EVENTOS.ALERTA, { tipo: 'erro', titulo: 'Campanha pausada', texto: motivo });
    }
    this._emitir(id, { motivo });
    return this.estado(id);
  }

  async continuar(id) {
    const campanha = campaignRepo.porId(id);
    if (!campanha) throw new AppError('Campanha nao encontrada.', 404);
    if (campanha.status === 'CONCLUIDA') throw new AppError('Essa campanha ja foi concluida.', 409);
    return this.iniciar(id);
  }

  parar(id, motivo = 'Parada pelo operador.') {
    const exec = this._exec(id);
    this.retomarAoConectar.delete(Number(id));
    exec.sinal.cancelar();
    exec.rodando = false;
    exec.fase = 'parado';
    exec.atual = null;
    exec.proximoEnvioEm = null;
    campaignRepo.atualizar(id, { status: 'PARADA', motivo_parada: motivo, finished_at: new Date().toISOString() });
    logger.warn('campanha', `Campanha parada: ${motivo}`);
    bus.emit(EVENTOS.CAMPANHA_STATUS, { id: Number(id), status: 'PARADA', motivo });
    this._emitir(id, { motivo });
    return this.estado(id);
  }

  _concluir(id) {
    const exec = this._exec(id);
    exec.rodando = false;
    exec.fase = 'concluido';
    exec.atual = null;
    exec.proximoEnvioEm = null;
    campaignRepo.atualizar(id, { status: 'CONCLUIDA', finished_at: new Date().toISOString() });
    const p = campaignRepo.progresso(id);
    logger.ok('campanha', `Campanha concluida: ${p.enviados} enviadas, ${p.erros} erros, ${p.ignorados} ignorados.`);
    bus.emit(EVENTOS.CAMPANHA_STATUS, { id: Number(id), status: 'CONCLUIDA' });
    bus.emit(EVENTOS.ALERTA, {
      tipo: 'sucesso',
      titulo: 'Prospeccao concluida',
      texto: `${p.enviados} mensagens enviadas.`
    });
    this._emitir(id);
  }

  async _loop(id) {
    const exec = this._exec(id);

    while (true) {
      if (exec.sinal.cancelado) return;

      const campanha = campaignRepo.porId(id);
      if (!campanha || campanha.status !== 'ATIVA') return;

      // --- horario automatico: fora da janela espera o proximo inicio ---
      const ateAbrir = msAteAbrir(campanha.horario_inicio, campanha.horario_fim);
      if (ateAbrir > 0) {
        if (exec.fase !== 'fora_horario') {
          logger.info(
            'campanha',
            `Fora do horario de envio (${campanha.horario_inicio} as ${campanha.horario_fim}). Retoma sozinha as ${campanha.horario_inicio}.`
          );
        }
        exec.fase = 'fora_horario';
        exec.atual = null;
        exec.pausaBlocoAte = null;
        exec.proximoEnvioEm = Date.now() + ateAbrir;
        this._emitir(id);
        // acorda no maximo a cada 30 min: relogio do PC que dormiu ou mudou nao atrasa o inicio
        const r = await esperaCancelavel(Math.min(ateAbrir, 30 * 60_000), exec.sinal);
        if (r === 'cancelado') return;
        if (msAteAbrir(campanha.horario_inicio, campanha.horario_fim) === 0) {
          exec.enviadosNoBloco = 0;
          logger.ok('campanha', `Horario de envio aberto: "${campanha.nome}" retomou a prospeccao.`);
        }
        continue;
      }

      // --- travas de seguranca antes de cada envio ---
      if (!whatsapp.conectado) {
        this.pausar(id, 'WhatsApp desconectado. A campanha foi pausada para evitar novos envios.', { automatico: true });
        return;
      }

      const cfg = settingsRepo.obterTodas();
      const limite = settingsRepo.limiteDiarioEfetivo(cfg);
      if (limite > 0 && messageRepo.enviadasHoje({ soCampanha: true }) >= limite) {
        this.pausar(id, `Limite diario de ${limite} mensagens de prospeccao atingido. Continue amanha.`, { automatico: true });
        return;
      }

      const item = campaignRepo.proximoPendente(id);
      if (!item) {
        this._concluir(id);
        return;
      }

      const lead = leadRepo.porId(item.lead_id);
      if (!lead) {
        campaignRepo.marcarItem(item.item_id, 'IGNORADO', { erro: 'Lead removido da base.' });
        campaignRepo.incrementar(id, 'ignorados');
        continue;
      }

      // --- NAO REPETIR LEAD (spec 10): telefone e a chave ---
      if (!lead.telefone_e164) {
        campaignRepo.marcarItem(item.item_id, 'IGNORADO', { erro: 'Lead sem telefone valido.' });
        campaignRepo.incrementar(id, 'ignorados');
        this._emitir(id);
        continue;
      }
      // Campanha de REATIVACAO e a unica excecao: o operador escolheu na mao
      // quem deve receber de novo (spec 70). Fora dela, a trava continua total.
      const reativacao = campanha.tipo === 'REATIVACAO';
      if (!reativacao && (lead.quantidade_mensagens_enviadas > 0 || leadRepo.jaFoiContatadoPorTelefone(lead.telefone_e164))) {
        campaignRepo.marcarItem(item.item_id, 'IGNORADO', { erro: 'Esse telefone ja recebeu mensagem antes.' });
        campaignRepo.incrementar(id, 'ignorados');
        logger.warn('campanha', `${lead.nome_estabelecimento} ignorado: ja foi contatado antes.`);
        this._emitir(id);
        continue;
      }

      exec.atual = { leadId: lead.id, nome: lead.nome_estabelecimento, cidade: lead.cidade };
      exec.fase = 'gerando';
      this._emitir(id);

      let texto = item.mensagem;
      if (!texto) {
        const gerada = await AIService.gerarPrimeiraMensagem(lead);
        texto = gerada.mensagem;
        campaignRepo.marcarItem(item.item_id, 'PENDENTE', { mensagem: texto });
      }

      exec.fase = 'enviando';
      this._emitir(id);

      try {
        await MessageService.enviar({
          lead,
          texto,
          campanha,
          autor: 'IA',
          removerDaProspeccao: Boolean(cfg.remover_da_prospeccao_ao_contatar)
        });
        campaignRepo.marcarItem(item.item_id, 'ENVIADO', { mensagem: texto });
        campaignRepo.incrementar(id, 'enviados');
        exec.errosConsecutivos = 0;
        exec.enviadosNoBloco += 1;
        // Sequencia de follow-up (+1, +3, +7) ja nasce agendada (spec 66).
        try {
          FollowUpService.agendarSequencia(lead.id, { campaignId: id });
        } catch (err) {
          logger.warn('campanha', `Nao consegui agendar o follow-up de ${lead.nome_estabelecimento}: ${err.message}`);
        }
      } catch (err) {
        const amigavel = mensagemAmigavel(err);
        campaignRepo.marcarItem(item.item_id, 'ERRO', { mensagem: texto, erro: amigavel });
        campaignRepo.incrementar(id, 'erros');
        campaignRepo.atualizar(id, { ultimo_erro: amigavel });
        exec.errosConsecutivos += 1;

        const maxErros = Number(cfg.max_erros_consecutivos || 3);
        if (exec.errosConsecutivos >= maxErros) {
          this.pausar(id, `${exec.errosConsecutivos} erros seguidos de envio. ${amigavel}`, { automatico: true });
          return;
        }
      }

      this._emitir(id);
      if (exec.sinal.cancelado) return;

      const restantes = campaignRepo.progresso(id)?.pendentes || 0;
      if (restantes === 0) {
        this._concluir(id);
        return;
      }

      // --- pausa entre blocos (spec 13) ---
      const blocoTamanho = Number(campanha.bloco_tamanho || cfg.bloco_tamanho || 0);
      const blocoPausa = Number(campanha.bloco_pausa_minutos || cfg.bloco_pausa_minutos || 0);
      if (blocoTamanho > 0 && blocoPausa > 0 && exec.enviadosNoBloco >= blocoTamanho) {
        exec.enviadosNoBloco = 0;
        exec.fase = 'pausa_bloco';
        exec.pausaBlocoAte = Date.now() + blocoPausa * 60_000;
        exec.proximoEnvioEm = exec.pausaBlocoAte;
        logger.info('campanha', `Pausa de bloco: ${blocoPausa} minuto(s) apos ${blocoTamanho} mensagens.`);
        this._emitir(id);
        const r = await esperaCancelavel(blocoPausa * 60_000, exec.sinal);
        exec.pausaBlocoAte = null;
        if (r === 'cancelado') return;
      } else {
        // --- delay aleatorio entre mensagens (spec 13) ---
        // piso do .env vale tambem para campanha criada antes da trava
        const faixa = faixaSegura(campanha.delay_min ?? cfg.delay_min, campanha.delay_max ?? cfg.delay_max);
        const ms = delayAleatorio(faixa.min, faixa.max);
        exec.fase = 'aguardando';
        exec.proximoEnvioEm = Date.now() + ms;
        logger.debug('campanha', `Aguardando ${Math.round(ms / 1000)}s ate o proximo envio.`);
        this._emitir(id);
        const r = await esperaCancelavel(ms, exec.sinal);
        if (r === 'cancelado') return;
      }

      exec.fase = 'enviando';
      exec.proximoEnvioEm = null;
    }
  }
}

export const campaignRunner = new CampaignRunner();
export default campaignRunner;
