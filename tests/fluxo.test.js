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
process.env.LIMITE_DIARIO = '0'; // nao depender do .env de quem roda o teste
process.env.BLOCO_TAMANHO = '0';

const { migrar, all } = await import('../server/db/index.js');
migrar();

const leadRepo = await import('../server/repositories/leadRepo.js');
const campaignRepo = await import('../server/repositories/campaignRepo.js');
const messageRepo = await import('../server/repositories/messageRepo.js');
const settingsRepo = await import('../server/repositories/settingsRepo.js');
const { default: whatsapp } = await import('../server/services/whatsapp/WhatsAppService.js');
const { default: campaignRunner } = await import('../server/services/CampaignRunner.js');
const { iniciarInbound, vincularNumero, repararContatosLid } = await import('../server/services/InboundHandler.js');
const { default: MessageService } = await import('../server/services/MessageService.js');
const { default: LabelService } = await import('../server/services/whatsapp/LabelService.js');
const { classificarHeuristico } = await import('../server/services/ai/AIService.js');
const { saudacaoDinamica } = await import('../server/utils/greeting.js');
const { normalizarTelefone } = await import('../server/utils/phone.js');
const { faixaSegura } = await import('../server/utils/delay.js');
const configModulo = await import('../server/config.js');

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
    // etiquetas do WhatsApp Business
    this.suportaEtiquetas = true;
    this.etiquetas = new Map();
    this.chatsEtiquetados = new Map(); // jid -> Set(labelId)
    this.semWhatsApp = new Set(); // numeros que nao existem no WhatsApp
    this.lids = new Map(); // telefone -> LID devolvido pela consulta
  }
  listarEtiquetas() {
    return [...this.etiquetas.values()];
  }
  async criarEtiqueta({ id, nome, cor }) {
    this.etiquetas.set(String(id), { id: String(id), nome, cor });
    return { id: String(id), nome, cor };
  }
  async aplicarEtiquetaNoChat(jid, labelId) {
    if (!this.chatsEtiquetados.has(jid)) this.chatsEtiquetados.set(jid, new Set());
    this.chatsEtiquetados.get(jid).add(String(labelId));
  }
  async removerEtiquetaDoChat(jid, labelId) {
    this.chatsEtiquetados.get(jid)?.delete(String(labelId));
  }
  etiquetasDoChat(tel) {
    return [...(this.chatsEtiquetados.get(`${tel}@s.whatsapp.net`) || [])];
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
    return this.semWhatsApp.has(String(tel)) ? null : `${tel}@s.whatsapp.net`;
  }
  async consultarNumero(tel) {
    const lid = this.lids.get(String(tel));
    if (lid) this.emit('numeroCompartilhado', { lid, telefone: tel });
    return this.existeNoWhatsApp(tel);
  }
  async enviarTexto(tel, texto) {
    if (this.falharProximo) {
      this.falharProximo = false;
      throw new Error('Connection Closed');
    }
    this.enviadas.push({ tel, texto });
    // destino pode ser telefone ou o endereco exato da conversa (xxx@lid)
    const jid = String(tel).includes('@') ? tel : `${tel}@s.whatsapp.net`;
    return { waId: `fake-${this.enviadas.length}`, jid };
  }
  receberDe({ jid, telefone = null, texto, pushName = 'Cliente' }) {
    const lid = String(jid).endsWith('@lid') ? jid : null;
    this.emit('mensagem', { telefone, jid, lid, texto, waId: `in-${Date.now()}-${Math.random()}`, pushName, timestamp: Date.now() });
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
  assert.match(ultima, /Henrique Camargo/);

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

test('etiquetas do CRM sao espelhadas no WhatsApp', async () => {
  await whatsapp.conectar();

  const r = await LabelService.sincronizar();
  assert.ok(r.criadas >= 15, 'todas as etiquetas padrao devem ser criadas');
  assert.equal(r.erros, 0);

  // ids 1..5 sao as etiquetas pre-definidas do WhatsApp: nao podem ser usados
  const ids = fake.listarEtiquetas().map((e) => Number(e.id));
  assert.ok(Math.min(...ids) >= 6, 'nao pode sobrescrever as etiquetas padrao do WhatsApp');

  const interessado = all("SELECT wa_label_id FROM tags WHERE slug = 'INTERESSADO'")[0];
  assert.ok(interessado.wa_label_id, 'o id da etiqueta fica salvo no banco');

  // aplicar no lead: entra a nova
  const lead = all('SELECT * FROM leads WHERE telefone_e164 IS NOT NULL LIMIT 1')[0];
  const aplicou = await LabelService.aplicarNoLead(lead, 'INTERESSADO');
  assert.equal(aplicou.aplicada, true);
  assert.deepEqual(fake.etiquetasDoChat(lead.telefone_e164), [interessado.wa_label_id]);

  // trocar de etiqueta: a anterior sai, so a nova fica
  const preco = all("SELECT wa_label_id FROM tags WHERE slug = 'QUER_SABER_PRECO'")[0];
  await LabelService.aplicarNoLead(lead, 'QUER_SABER_PRECO', 'INTERESSADO');
  assert.deepEqual(
    fake.etiquetasDoChat(lead.telefone_e164),
    [preco.wa_label_id],
    'a etiqueta antiga precisa sair do chat'
  );

  // rodar de novo nao duplica nada
  const segunda = await LabelService.sincronizar();
  assert.equal(segunda.criadas, 0);
  assert.equal(segunda.jaMapeadas, r.criadas + r.reaproveitadas);
});

test('etiquetar no WhatsApp nunca derruba o fluxo quando falha', async () => {
  const lead = all('SELECT * FROM leads WHERE telefone_e164 IS NOT NULL LIMIT 1')[0];
  await fake.encerrar(); // WhatsApp fora do ar

  const r = await LabelService.aplicarNoLead(lead, 'INTERESSADO');
  assert.equal(r.aplicada, false, 'sem conexao nao aplica');
  assert.ok(r.motivo, 'e explica o porque, sem lancar excecao');
});

/* ---------------------------------------------------------- LID do WhatsApp */

test('conversa que chega por LID vira lead sem telefone e a resposta vai para o LID', async () => {
  await whatsapp.conectar();
  const lid = '264514553557138@lid';

  fake.receberDe({ jid: lid, texto: 'oi, quero saber mais', pushName: 'Rick' });
  await esperar(900);

  const lead = leadRepo.porWaJid(lid);
  assert.ok(lead, 'o lead precisa ser criado a partir do LID');
  assert.equal(lead.telefone_e164, null, 'os digitos do LID nunca podem virar telefone');
  assert.equal(lead.nome_estabelecimento, 'Rick');

  const antes = fake.enviadas.length;
  await MessageService.enviar({ lead, texto: 'Oi Rick, tudo bem?', autor: 'OPERADOR' });
  assert.equal(fake.enviadas.length, antes + 1);
  assert.equal(fake.enviadas.at(-1).tel, lid, 'a resposta precisa ir para o endereco exato da conversa');

  // segunda mensagem da mesma pessoa cai no mesmo lead
  fake.receberDe({ jid: lid, texto: 'e o preco?', pushName: 'Rick' });
  await esperar(900);
  assert.equal(all('SELECT COUNT(*) AS n FROM leads WHERE wa_jid = ?', lid)[0].n, 1);
});

test('resposta por LID com numero informado cai no lead que foi prospectado', async () => {
  await whatsapp.conectar();
  const { lead: prospectado } = leadRepo.criarOuEnriquecer({ nome_estabelecimento: 'Clinica LID', telefone: '16997771234' });
  const totalAntes = all('SELECT COUNT(*) AS n FROM leads')[0].n;

  fake.receberDe({ jid: '998877665544332@lid', telefone: '5516997771234', texto: 'pode mandar o modelo' });
  await esperar(900);

  assert.equal(all('SELECT COUNT(*) AS n FROM leads')[0].n, totalAntes, 'nao pode criar lead duplicado');
  const atualizado = leadRepo.porId(prospectado.id);
  assert.equal(atualizado.respondeu, 1);
  assert.equal(atualizado.wa_jid, '998877665544332@lid', 'a conversa passa a responder pelo LID');
});

test('quando o WhatsApp revela o numero, a conversa por LID se junta ao lead do telefone', async () => {
  const { lead: doTelefone } = leadRepo.criarOuEnriquecer({ nome_estabelecimento: 'Padaria Unir', telefone: '16996665555' });
  const doLid = leadRepo.criarDeWhatsApp({ nome: 'Contato do WhatsApp', wa_jid: '112233445566778@lid' });
  messageRepo.registrar({ lead_id: doLid.id, direcao: 'IN', corpo: 'tenho interesse', status: 'RECEBIDA', autor: 'CLIENTE' });

  vincularNumero({ lid: '112233445566778@lid', telefone: '5516996665555' });

  assert.equal(leadRepo.porId(doLid.id), undefined, 'o lead duplicado do LID some');
  const unido = leadRepo.porId(doTelefone.id);
  assert.equal(unido.wa_jid, '112233445566778@lid');
  assert.equal(unido.respondeu, 1);
  assert.equal(messageRepo.doLead(unido.id).filter((m) => m.direcao === 'IN').length, 1, 'a mensagem veio junto');
});

test('travas do .env: painel nao deixa o intervalo nem o limite diario mais agressivos', () => {
  const { config } = configModulo;
  const antes = { ...config.operacao };
  try {
    config.operacao.delayMin = 60;
    config.operacao.limiteDiario = 30;
    assert.deepEqual(faixaSegura(5, 10), { min: 60, max: 60 }, 'os 5-10s que restringiram o numero');
    assert.deepEqual(faixaSegura(90, 180), { min: 90, max: 180 }, 'mais conservador que o piso continua valendo');
    assert.equal(settingsRepo.limiteDiarioEfetivo({ limite_diario: 200 }), 30);
    assert.equal(settingsRepo.limiteDiarioEfetivo({ limite_diario: 0 }), 30, '0 no painel nao tira o teto');
    assert.equal(settingsRepo.limiteDiarioEfetivo({ limite_diario: 10 }), 10);
  } finally {
    Object.assign(config.operacao, antes);
  }
});

test('classificacao local: robo do WhatsApp Business nao vira interessado', () => {
  assert.equal(classificarHeuristico('Seja bem-vindo(a) a Odonto+! Aguarde que ja vamos te atender').status, 'AGUARDANDO_RESPOSTA');
  assert.equal(classificarHeuristico('Bartolomeu Clinic agradece seu contato. Como podemos ajudar?').status, 'RESPONDEU');
  assert.equal(classificarHeuristico('sim, tenho interesse sim').status, 'INTERESSADO');
});

test('resposta so por LID (sem numero) cai no lead prospectado, antes e depois de conectar', async () => {
  await whatsapp.conectar();

  // envio novo: a consulta do numero revela o LID e ele fica guardado no lead
  const { lead: novo } = leadRepo.criarOuEnriquecer({ nome_estabelecimento: 'Clinica Sorriso LID', telefone: '16995551111' });
  fake.lids.set('5516995551111', '555000111222333@lid');
  await whatsapp.consultarNumero('5516995551111');
  const totalAntes = all('SELECT COUNT(*) AS n FROM leads')[0].n;

  fake.receberDe({ jid: '555000111222333@lid', texto: 'Seja bem-vindo! Aguarde que ja vamos atender.', pushName: null });
  await esperar(900);
  assert.equal(all('SELECT COUNT(*) AS n FROM leads')[0].n, totalAntes, 'nao pode virar "Contato do WhatsApp" solto');
  assert.equal(leadRepo.porId(novo.id).respondeu, 1);

  // resposta que ja tinha chegado solta: ao conectar, junta com quem foi contatado
  const { lead: antigo } = leadRepo.criarOuEnriquecer({ nome_estabelecimento: 'Odonto Orfa', telefone: '16995552222' });
  leadRepo.atualizar(antigo.id, { quantidade_mensagens_enviadas: 1 });
  const orfao = leadRepo.criarDeWhatsApp({ nome: 'Contato do WhatsApp', wa_jid: '555000222333444@lid' });
  messageRepo.registrar({ lead_id: orfao.id, direcao: 'IN', corpo: 'Como podemos ajudar?', status: 'RECEBIDA', autor: 'CLIENTE' });
  fake.lids.set('5516995552222', '555000222333444@lid');

  await repararContatosLid();

  assert.equal(leadRepo.porId(orfao.id), undefined, 'o contato solto some');
  assert.equal(messageRepo.doLead(antigo.id).filter((m) => m.direcao === 'IN').length, 1, 'a resposta vai para o lead certo');
});

test('lead antigo com LID gravado como telefone e corrigido ao conectar', async () => {
  await whatsapp.conectar();
  const falso = '264500000000001';
  fake.semWhatsApp.add(falso);
  const { lead } = leadRepo.criarOuEnriquecer({ nome_estabelecimento: `+${falso}`, telefone: falso }, 'WHATSAPP_INBOUND');
  assert.equal(lead.telefone_e164, falso);

  await repararContatosLid();

  const corrigido = leadRepo.porId(lead.id);
  assert.equal(corrigido.telefone_e164, null);
  assert.equal(corrigido.wa_jid, `${falso}@lid`);
  assert.equal(corrigido.nome_estabelecimento, 'Contato do WhatsApp', 'nome que era so o numero e trocado');
});

/** "HH:MM" em Brasilia daqui a N minutos. */
const horaDaquiA = (min) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(Date.now() + min * 60_000));

test('fora do horario automatico a campanha espera e nao envia nada', async () => {
  await whatsapp.conectar();
  const lead = leadRepo.criarOuEnriquecer({ nome_estabelecimento: 'Lead Horario', telefone: '16988771234' }).lead;
  const campanha = campaignRepo.criar({
    nome: 'Agendada', delay_min: 1, delay_max: 1, bloco_tamanho: 0,
    horario_inicio: horaDaquiA(120), horario_fim: horaDaquiA(180)
  });
  campaignRepo.enfileirar(campanha.id, [lead]);

  const antes = fake.enviadas.length;
  await campaignRunner.iniciar(campanha.id);
  await esperar(300);

  const estado = campaignRunner.estado(campanha.id);
  assert.equal(estado.campanha.status, 'ATIVA', 'fica ligada esperando o horario');
  assert.equal(estado.fase, 'fora_horario');
  assert.ok(estado.proximoEnvioEm > Date.now() + 60 * 60_000, 'proximo envio so no horario de inicio');
  assert.equal(fake.enviadas.length, antes, 'nenhuma mensagem fora do horario');

  // WhatsApp caindo de madrugada nao pausa quem so esta esperando o horario
  await fake.encerrar();
  await esperar(100);
  assert.equal(campaignRepo.porId(campanha.id).status, 'ATIVA');
  await whatsapp.conectar();

  campaignRunner.parar(campanha.id); // libera o timer da espera
});

test('campanha com horario retoma sozinha depois de reiniciar o servidor', async () => {
  const lead = leadRepo.criarOuEnriquecer({ nome_estabelecimento: 'Lead Reboot', telefone: '16988775678' }).lead;
  const campanha = campaignRepo.criar({
    nome: 'Reboot', delay_min: 1, delay_max: 1, bloco_tamanho: 0,
    horario_inicio: horaDaquiA(120), horario_fim: horaDaquiA(180)
  });
  campaignRepo.enfileirar(campanha.id, [lead]);
  campaignRepo.atualizar(campanha.id, { status: 'ATIVA' }); // estava rodando quando o PC desligou
  const semHorario = campaignRepo.criar({ nome: 'Reboot sem horario', delay_min: 1, delay_max: 1 });
  campaignRepo.atualizar(semHorario.id, { status: 'ATIVA' });

  await fake.encerrar();
  campaignRunner.restaurarNoBoot();
  assert.equal(campaignRepo.porId(campanha.id).status, 'PAUSADA');
  assert.match(campaignRepo.porId(campanha.id).motivo_parada, /retoma sozinha/);

  await whatsapp.conectar(); // WhatsApp reconecta depois do boot
  await esperar(300);
  assert.equal(campaignRepo.porId(campanha.id).status, 'ATIVA', 'a agendada volta sozinha');
  assert.equal(campaignRepo.porId(semHorario.id).status, 'PAUSADA', 'a sem horario continua esperando o operador');

  campaignRunner.parar(campanha.id);
  campaignRunner.parar(semHorario.id);
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
