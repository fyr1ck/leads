/**
 * Teste de ponta a ponta do fluxo critico, com um provider de WhatsApp falso.
 * Roda 100% local, sem internet e sem WhatsApp real:
 *
 *   npm test
 *
 * Cobre: importacao, deduplicacao, fila de campanha, envio com delay,
 * pausa automatica por desconexao e - o mais importante - a REGRA DE OURO:
 * mensagem recebida NUNCA gera resposta automatica.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'henvix-test-'));
process.env.DATABASE_URL = path.join(tmp, 'teste.db');
process.env.WA_SESSION_DIR = path.join(tmp, 'wa');
process.env.GROQ_API_KEY = '';
process.env.DELAY_MIN = '1';
process.env.DELAY_MAX = '1';
process.env.BLOCO_TAMANHO = '0';

const { migrar, all } = await import('../server/db/index.js');
migrar();

const leadRepo = await import('../server/repositories/leadRepo.js');
const campaignRepo = await import('../server/repositories/campaignRepo.js');
const messageRepo = await import('../server/repositories/messageRepo.js');
const settingsRepo = await import('../server/repositories/settingsRepo.js');
const { default: whatsapp } = await import('../server/services/whatsapp/WhatsAppService.js');
const { default: campaignRunner } = await import('../server/services/CampaignRunner.js');
const { iniciarInbound } = await import('../server/services/InboundHandler.js');
const { classificarHeuristico } = await import('../server/services/ai/AIService.js');
const { saudacaoDinamica } = await import('../server/utils/greeting.js');
const { normalizarTelefone } = await import('../server/utils/phone.js');

/** Provider falso: implementa o mesmo contrato do BaileysProvider. */
class FakeProvider extends EventEmitter {
  constructor() {
    super();
    this.nome = 'fake';
    this.status = 'DESCONECTADO';
    this.numero = '5516999999999';
    this.pushName = 'Teste';
    this.enviadas = [];
    this.falharProximo = false;
  }
  async iniciar() {
    this.status = 'CONECTADO';
    this.emit('status', { status: 'CONECTADO', numero: this.numero, pushName: this.pushName });
  }
  async encerrar() {
    this.status = 'DESCONECTADO';
    this.emit('status', { status: 'DESCONECTADO' });
  }
  async existeNoWhatsApp(tel) {
    return `${tel}@s.whatsapp.net`;
  }
  async enviarTexto(tel, texto) {
    if (this.falharProximo) {
      this.falharProximo = false;
      throw new Error('Connection Closed');
    }
    this.enviadas.push({ tel, texto });
    return { waId: `fake-${this.enviadas.length}`, jid: `${tel}@s.whatsapp.net` };
  }
  receber(tel, texto) {
    this.emit('mensagem', { telefone: tel, texto, waId: `in-${Date.now()}-${Math.random()}`, pushName: 'Cliente', timestamp: Date.now() });
  }
}

const fake = new FakeProvider();
whatsapp.trocarProvider(fake);
campaignRunner.monitorarConexao();
iniciarInbound();
settingsRepo.salvar({ delay_min: 1, delay_max: 1, bloco_tamanho: 0, limite_diario: 0 });

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

test('saudacao dinamica respeita as faixas da Skill', () => {
  const em = (h) => {
    const d = new Date();
    // constroi uma data no horario de Brasilia informado
    const iso = `${d.toISOString().slice(0, 10)}T${String(h).padStart(2, '0')}:30:00-03:00`;
    return saudacaoDinamica(new Date(iso));
  };
  assert.equal(em(8), 'Bom dia');
  assert.equal(em(14), 'Boa tarde');
  assert.equal(em(21), 'Boa noite');
  assert.equal(em(3), 'Boa noite');
});

test('telefone normaliza e nunca inventa numero', () => {
  assert.equal(normalizarTelefone('(16) 99123-4567'), '5516991234567');
  assert.equal(normalizarTelefone('+55 16 3333-4455'), '551633334455');
  assert.equal(normalizarTelefone('99123-4567'), null);
  assert.equal(normalizarTelefone(''), null);
});

test('duplicidade: mesmo telefone nao cria segundo lead', () => {
  const a = leadRepo.criarOuEnriquecer({ nome_estabelecimento: 'Bar do Teste', telefone: '(16) 99111-2222', cidade: 'Ribeirao Preto' });
  const b = leadRepo.criarOuEnriquecer({ nome_estabelecimento: 'Bar do Teste 2', telefone: '16991112222' });
  assert.equal(a.acao, 'CRIADO');
  assert.notEqual(b.acao, 'CRIADO');
  assert.equal(a.lead.id, b.lead.id);
});

test('duplicidade: sem telefone usa nome + endereco', () => {
  const a = leadRepo.criarOuEnriquecer({ nome_estabelecimento: 'Oficina Sem Fone', endereco: 'Rua A, 10' });
  const b = leadRepo.criarOuEnriquecer({ nome_estabelecimento: 'Oficina Sem Fone', endereco: 'Rua A, 10' });
  assert.equal(a.acao, 'CRIADO');
  assert.equal(b.acao, 'DUPLICADO');
});

test('enriquecimento completa campos vazios sem duplicar o lead', () => {
  leadRepo.criarOuEnriquecer({ nome_estabelecimento: 'Pizzaria Enriquecer', telefone: '16990001111' });
  const r = leadRepo.criarOuEnriquecer({
    nome_estabelecimento: 'Pizzaria Enriquecer',
    telefone: '16990001111',
    google_maps: 'https://maps.google.com/x',
    cidade: 'Franca'
  });
  assert.equal(r.acao, 'ATUALIZADO');
  assert.equal(r.lead.cidade, 'Franca');
  assert.equal(r.lead.google_maps, 'https://maps.google.com/x');
});

test('campanha envia, respeita a fila e nao repete telefone', async () => {
  await whatsapp.conectar();
  assert.equal(whatsapp.conectado, true);

  const leads = leadRepo.disponiveisParaProspeccao({}, 3);
  assert.ok(leads.length >= 2, 'precisa de leads disponiveis');

  const campanha = campaignRepo.criar({ nome: 'Campanha de teste', quantidade_alvo: leads.length, delay_min: 1, delay_max: 1, bloco_tamanho: 0, bloco_pausa_minutos: 0 });
  campaignRepo.enfileirar(campanha.id, leads);

  const antes = fake.enviadas.length;
  await campaignRunner.iniciar(campanha.id);
  for (let i = 0; i < 60 && campaignRepo.porId(campanha.id).status === 'ATIVA'; i += 1) await esperar(250);

  const p = campaignRepo.progresso(campanha.id);
  assert.equal(p.pendentes, 0, 'a fila deve terminar');
  assert.equal(p.enviados, leads.length);
  assert.equal(fake.enviadas.length, antes + leads.length);
  assert.equal(campaignRepo.porId(campanha.id).status, 'CONCLUIDA');

  // a mensagem gerada segue a Skill (saudacao + apresentacao)
  const ultima = fake.enviadas.at(-1).texto;
  assert.match(ultima, /Bom dia|Boa tarde|Boa noite/);
  assert.match(ultima, /João Henrique/);

  // segunda campanha com os mesmos leads: tudo ignorado (spec 10)
  const c2 = campaignRepo.criar({ nome: 'Repetida', delay_min: 1, delay_max: 1, bloco_tamanho: 0 });
  campaignRepo.enfileirar(c2.id, leads);
  const enviadasAntes = fake.enviadas.length;
  await campaignRunner.iniciar(c2.id);
  for (let i = 0; i < 40 && campaignRepo.porId(c2.id).status === 'ATIVA'; i += 1) await esperar(200);
  const p2 = campaignRepo.progresso(c2.id);
  assert.equal(p2.ignorados, leads.length, 'todos deveriam ser ignorados por duplicidade');
  assert.equal(fake.enviadas.length, enviadasAntes, 'nenhum envio novo');
});

test('REGRA DE OURO: resposta do cliente nunca gera envio automatico', async () => {
  const lead = all("SELECT * FROM leads WHERE quantidade_mensagens_enviadas > 0 LIMIT 1")[0];
  assert.ok(lead, 'precisa de um lead contatado');

  const enviadasAntes = fake.enviadas.length;
  const outAntes = messageRepo.listar({ direcao: 'OUT' }).total;

  fake.receber(lead.telefone_e164, 'Pode me mandar o modelo?');
  await esperar(1200);

  const conversa = messageRepo.doLead(lead.id, 50);
  const entrada = conversa.filter((m) => m.direcao === 'IN');
  assert.equal(entrada.length, 1, 'a mensagem recebida deve ser salva');

  // nada foi enviado em resposta
  assert.equal(fake.enviadas.length, enviadasAntes, 'a IA nao pode responder o cliente');
  assert.equal(messageRepo.listar({ direcao: 'OUT' }).total, outAntes);

  // mas o lead foi classificado e ganhou etiqueta + sugestao guardada
  const atualizado = leadRepo.porId(lead.id);
  assert.equal(atualizado.respondeu, 1);
  assert.ok(atualizado.etiqueta, 'o lead deve receber etiqueta');
  assert.equal(atualizado.etiqueta, classificarHeuristico('Pode me mandar o modelo?').status);
  const analises = all('SELECT * FROM ai_analyses WHERE lead_id = ?', lead.id);
  assert.ok(analises.length >= 1, 'a analise deve ficar registrada');
});

test('campanha pausa automaticamente quando o WhatsApp cai', async () => {
  const novos = [];
  for (let i = 0; i < 3; i += 1) {
    novos.push(leadRepo.criarOuEnriquecer({ nome_estabelecimento: `Lead Queda ${i}`, telefone: `1698800${String(i).padStart(4, '0')}` }).lead);
  }
  const campanha = campaignRepo.criar({ nome: 'Queda', delay_min: 2, delay_max: 2, bloco_tamanho: 0 });
  campaignRepo.enfileirar(campanha.id, novos);

  await campaignRunner.iniciar(campanha.id);
  await esperar(300);
  await fake.encerrar(); // simula desconexao do WhatsApp
  await esperar(400);

  const c = campaignRepo.porId(campanha.id);
  assert.equal(c.status, 'PAUSADA');
  assert.match(c.motivo_parada || '', /desconectado/i);
  assert.ok(campaignRepo.progresso(campanha.id).pendentes > 0, 'a fila continua salva para retomar depois');
});

test('so a campanha de REATIVACAO pode reenviar para quem ja foi contatado', async () => {
  // o teste anterior derruba a conexao de proposito
  await whatsapp.conectar();

  const contatado = all('SELECT * FROM leads WHERE quantidade_mensagens_enviadas > 0 LIMIT 1')[0];
  assert.ok(contatado, 'precisa de um lead ja contatado');

  // 1) campanha comum: continua ignorando por duplicidade
  const comum = campaignRepo.criar({ nome: 'Comum', delay_min: 1, delay_max: 1, bloco_tamanho: 0 });
  campaignRepo.enfileirar(comum.id, [contatado]);
  const antesComum = fake.enviadas.length;
  await campaignRunner.iniciar(comum.id);
  for (let i = 0; i < 30 && campaignRepo.porId(comum.id).status === 'ATIVA'; i += 1) await esperar(150);
  assert.equal(campaignRepo.progresso(comum.id).ignorados, 1, 'campanha comum deve ignorar');
  assert.equal(fake.enviadas.length, antesComum, 'nenhum envio na campanha comum');

  // 2) campanha de reativacao: o operador escolheu, entao envia
  const reativacao = campaignRepo.criar({ nome: 'Reativacao', delay_min: 1, delay_max: 1, bloco_tamanho: 0 });
  campaignRepo.atualizar(reativacao.id, { tipo: 'REATIVACAO' });
  campaignRepo.enfileirar(reativacao.id, [contatado]);
  const antesReativacao = fake.enviadas.length;
  await campaignRunner.iniciar(reativacao.id);
  for (let i = 0; i < 30 && campaignRepo.porId(reativacao.id).status === 'ATIVA'; i += 1) await esperar(150);
  assert.equal(campaignRepo.progresso(reativacao.id).enviados, 1, 'reativacao deve enviar');
  assert.equal(fake.enviadas.length, antesReativacao + 1);
});

test('historico permanece mesmo depois de limpar a prospeccao', () => {
  const antes = all("SELECT COUNT(*) AS n FROM contact_history WHERE tipo = 'ENVIO'")[0].n;
  leadRepo.limparProspeccaoContatados();
  const depois = all("SELECT COUNT(*) AS n FROM contact_history WHERE tipo = 'ENVIO'")[0].n;
  assert.equal(depois, antes);
  const naProspeccao = all('SELECT COUNT(*) AS n FROM leads WHERE na_prospeccao = 1 AND quantidade_mensagens_enviadas > 0')[0].n;
  assert.equal(naProspeccao, 0);
});

test('resposta automatica nao pode ser ligada nem pela API de settings', () => {
  const cfg = settingsRepo.salvar({ ia_resposta_automatica: 1 });
  assert.equal(cfg.ia_resposta_automatica, 0);
});

test.after(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* windows pode manter lock do arquivo do banco */
  }
});
