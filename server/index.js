import http from 'node:http';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import { config, paths } from './config.js';
import { migrar, estatisticasBanco } from './db/index.js';
import { bus, EVENTOS } from './realtime/bus.js';
import * as logRepo from './repositories/logRepo.js';
import { logger } from './utils/logger.js';
import rotas from './routes/index.js';
import { errorHandler, notFound } from './middleware/index.js';
import { criarSocket } from './realtime/socket.js';
import whatsapp from './services/whatsapp/WhatsAppService.js';
import campaignRunner from './services/CampaignRunner.js';
import { iniciarInbound } from './services/InboundHandler.js';
import AIService from './services/ai/AIService.js';
import { carregarSkill } from './services/ai/skillLoader.js';

// ------------------------------------------------------------------ banco
migrar();
bus.on(EVENTOS.LOG, (entrada) => {
  try {
    logRepo.registrar(entrada);
  } catch {
    /* nao deixa falha de log derrubar nada */
  }
});
logRepo.podar(5000);

// ------------------------------------------------------------------ express
const app = express();

app.use(
  cors({
    origin: [
      `http://localhost:${config.webPort}`,
      `http://127.0.0.1:${config.webPort}`,
      `http://localhost:${config.port}`
    ]
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', rotas);

// Em producao o backend tambem serve o painel compilado (tudo em localhost).
if (fs.existsSync(paths.clientDist)) {
  app.use(express.static(paths.clientDist));
  app.get(/^\/(?!api|socket\.io).*/, (req, res) => res.sendFile(`${paths.clientDist}/index.html`));
}

app.use('/api', notFound);
app.use(errorHandler);

// ------------------------------------------------------------------ servidor
const server = http.createServer(app);
criarSocket(server);

function caixa(linhas) {
  const largura = 46;
  const topo = `╔${'═'.repeat(largura)}╗`;
  const meio = `╠${'═'.repeat(largura)}╣`;
  const base = `╚${'═'.repeat(largura)}╝`;
  const centralizar = (t) => {
    const espaco = largura - t.length;
    const esq = Math.max(0, Math.floor(espaco / 2));
    return `║${' '.repeat(esq)}${t}${' '.repeat(Math.max(0, espaco - esq))}║`;
  };
  const item = ({ rotulo, valor, cor }) => {
    const texto = `  ${rotulo.padEnd(12)}${valor}`;
    const pad = ' '.repeat(Math.max(0, largura - texto.length));
    const colorido = cor ? texto.replace(valor, `${cor}${valor}\x1b[0m`) : texto;
    return `║${colorido}${pad}║`;
  };
  return [topo, centralizar('HENVIX SALES PANEL'), meio, ...linhas.map(item), base].join('\n');
}

const VERDE = '\x1b[32m';
const AMARELO = '\x1b[33m';
const VERMELHO = '\x1b[31m';

async function banner() {
  const ia = await Promise.race([
    AIService.status(),
    new Promise((r) => setTimeout(() => r({ groq: { conectado: false, motivo: 'sem resposta' } }), 6000))
  ]);
  const db = estatisticasBanco();
  const wa = whatsapp.estado();

  const statusGroq = !ia.groq?.configurado
    ? { valor: 'NAO CONFIGURADO', cor: AMARELO }
    : ia.groq?.conectado
      ? { valor: 'CONNECTED', cor: VERDE }
      : { valor: 'OFFLINE', cor: VERMELHO };

  const statusWa =
    wa.status === 'CONECTADO'
      ? { valor: 'CONNECTED', cor: VERDE }
      : wa.status === 'CONECTANDO' || wa.status === 'QRCODE'
        ? { valor: wa.status === 'QRCODE' ? 'AGUARDANDO QR' : 'CONECTANDO', cor: AMARELO }
        : { valor: 'DISCONNECTED', cor: VERMELHO };

  console.log(
    `\n${caixa([
      { rotulo: 'Painel:', valor: `http://localhost:${config.webPort}`, cor: '\x1b[36m' },
      { rotulo: 'API:', valor: `http://localhost:${config.port}`, cor: '\x1b[36m' },
      { rotulo: 'Database:', valor: `ONLINE (${db.leads} leads)`, cor: VERDE },
      { rotulo: 'Groq:', valor: statusGroq.valor, cor: statusGroq.cor },
      { rotulo: 'WhatsApp:', valor: statusWa.valor, cor: statusWa.cor },
      { rotulo: 'Skill:', valor: ia.skill?.carregada ? 'CARREGADA' : 'NAO ENCONTRADA', cor: ia.skill?.carregada ? VERDE : VERMELHO },
      { rotulo: 'Resp. auto:', valor: 'DESATIVADA (por design)', cor: VERDE }
    ])}\n`
  );
}

/**
 * Porta ocupada quase sempre significa "o painel ja esta rodando".
 * Sem isso o processo continuava vivo sem servir nada - e, pior, abria uma
 * segunda sessao do WhatsApp que brigava com a primeira (erro 440).
 */
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n\x1b[31m✖ A porta ${config.port} ja esta em uso.\x1b[0m\n` +
        '  O painel provavelmente ja esta rodando em outra janela.\n' +
        `  Abra http://localhost:${config.webPort} ou feche o outro servidor antes de subir de novo.\n`
    );
    process.exit(1);
  }
  logger.erro('servidor', `Erro no servidor HTTP: ${err.message}`);
  process.exit(1);
});

server.listen(config.port, async () => {
  carregarSkill({ forcar: true });
  logger.ok('servidor', `API local ouvindo em http://localhost:${config.port}`);

  campaignRunner.monitorarConexao();
  campaignRunner.restaurarNoBoot();
  iniciarInbound();

  await banner();

  // Restaura a sessao do WhatsApp em segundo plano (nao bloqueia o painel).
  whatsapp.iniciarSeTiverSessao().catch((err) => logger.erro('whatsapp', err.message));
});

// ------------------------------------------------------------------ robustez
process.on('unhandledRejection', (err) => {
  logger.erro('processo', `Promessa rejeitada sem tratamento: ${err?.message || err}`);
});
process.on('uncaughtException', (err) => {
  logger.erro('processo', `Excecao nao tratada: ${err?.message || err}`);
});

const encerrar = async (sinal) => {
  logger.warn('servidor', `Recebido ${sinal}. Encerrando com seguranca...`);
  try {
    for (const [id, exec] of campaignRunner.execucoes) {
      if (exec.rodando) campaignRunner.pausar(id, 'Servidor encerrado.', { automatico: true });
    }
    await whatsapp.desconectar({ logout: false });
  } catch {
    /* encerramento best-effort */
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
};
process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));

export { app, server };
