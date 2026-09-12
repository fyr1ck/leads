/**
 * Testes da camada v2 (Sales OS): busca de leads, score, follow-up, demo,
 * venda, timeline e reativacao. Roda local, sem internet e sem WhatsApp real:
 *
 *   npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'henvix-v2-'));
process.env.DATABASE_URL = path.join(tmp, 'teste.db');
process.env.WA_SESSION_DIR = path.join(tmp, 'wa');
process.env.GROQ_API_KEY = '';
process.env.GOOGLE_MAPS_API_KEY = '';
process.env.DELAY_MIN = '1';
process.env.DELAY_MAX = '1';
process.env.BLOCO_TAMANHO = '0';

const { migrar, all } = await import('../server/db/index.js');
migrar();

const leadRepo = await import('../server/repositories/leadRepo.js');
const prospectRepo = await import('../server/repositories/prospectRepo.js');
const { default: ScoreService } = await import('../server/services/ScoreService.js');
const { default: DemoService } = await import('../server/services/DemoService.js');
const { default: SalesService } = await import('../server/services/SalesService.js');
const { default: FollowUpService } = await import('../server/services/FollowUpService.js');
const { default: ReactivationService } = await import('../server/services/ReactivationService.js');
const { default: ActivityService } = await import('../server/services/ActivityService.js');
const { default: LeadFinderService } = await import('../server/services/prospect/LeadFinderService.js');
const { classificarSite, prioridadeProspeccao, dominioDe } = await import('../server/domain/nichos.js');
const { default: whatsapp } = await import('../server/services/whatsapp/WhatsAppService.js');

/* ------------------------------------------------------------ 59.4 / 59.5 */

test('rede social nao conta como site proprio', () => {
  assert.equal(classificarSite('https://www.instagram.com/barbearia').status, 'SEM_SITE');
  assert.equal(classificarSite('https://facebook.com/barbearia').status, 'SEM_SITE');
  assert.equal(classificarSite('https://linktr.ee/barbearia').status, 'SEM_SITE');
  // o instagram encontrado vira dado do lead, nao site
  assert.match(classificarSite('https://instagram.com/barbearia').instagram || '', /instagram/);
});

test('site proprio e identificado; agregador pede verificacao manual', () => {
  assert.equal(classificarSite('https://barbearianavalha.com.br').status, 'COM_SITE');
  assert.equal(classificarSite('https://www.ifood.com.br/delivery/x').status, 'VERIFICAR');
  assert.equal(classificarSite(null).status, 'SEM_SITE');
  assert.equal(dominioDe('https://www.exemplo.com.br/pagina'), 'exemplo.com.br');
});

test('priorizacao da prospeccao usa apenas fatos disponiveis', () => {
  const alta = prioridadeProspeccao({ status_site: 'SEM_SITE', telefone: '5516999999999', instagram: 'x', total_avaliacoes: 80 });
  const media = prioridadeProspeccao({ status_site: 'SEM_SITE', telefone: '5516999999999', total_avaliacoes: 2 });
  const baixa = prioridadeProspeccao({ status_site: 'SEM_SITE', telefone: null });
  assert.equal(alta.prioridade, 'ALTA');
  assert.equal(media.prioridade, 'MEDIA');
  assert.equal(baixa.prioridade, 'BAIXA');
});

/* ------------------------------------------------------------------ 59.15 */

test('resultado da busca nao duplica lead que ja esta no CRM', () => {
  const { lead } = leadRepo.criarOuEnriquecer(
    { nome_estabelecimento: 'Barbearia Duplicada', telefone: '16991110000', place_id: 'PLACE-123' },
    'GOOGLE_MAPS'
  );

  const r = prospectRepo.salvarResultado({
    place_id: 'PLACE-123',
    nome: 'Barbearia Duplicada',
    telefone_e164: '5516991110000',
    nicho: 'BARBEARIAS',
    status_site: 'SEM_SITE'
  });

  const resultado = LeadFinderService.adicionarAoCrm(r.id);
  assert.equal(resultado.acao, 'DUPLICADO');
  assert.equal(resultado.lead_id, lead.id);
  assert.equal(resultado.criterio, 'place_id');
});

test('resultado novo entra no CRM com origem e timeline', () => {
  const r = prospectRepo.salvarResultado({
    place_id: 'PLACE-NOVO',
    nome: 'Barbearia Nova',
    telefone: '(16) 99222-3333',
    telefone_e164: '5516992223333',
    cidade: 'Ribeirao Preto',
    estado: 'SP',
    google_maps: 'https://maps.google.com/nova',
    status_site: 'SEM_SITE',
    prioridade: 'ALTA',
    nicho: 'BARBEARIAS'
  });

  const { acao, lead } = LeadFinderService.adicionarAoCrm(r.id);
  assert.equal(acao, 'CRIADO');
  assert.equal(lead.origem, 'GOOGLE_MAPS');
  assert.equal(lead.place_id, 'PLACE-NOVO');
  assert.equal(lead.status_site, 'SEM_SITE');

  const timeline = ActivityService.doLead(lead.id);
  assert.ok(timeline.some((a) => a.tipo === 'LEAD_ENCONTRADO'), 'a descoberta deve virar evento na timeline');
});

/* --------------------------------------------------------------------- 61 */

test('score sobe com sinais reais e explica cada ponto', () => {
  const { lead } = leadRepo.criarOuEnriquecer({ nome_estabelecimento: 'Pizzaria Score', telefone: '16993330000' });

  const inicial = ScoreService.recalcular(lead.id);
  const semSite = inicial.motivos.find((m) => /site proprio/i.test(m.texto));
  assert.ok(semSite, 'lead sem site ganha ponto');

  leadRepo.atualizar(lead.id, { etiqueta: 'QUER_SABER_PRECO', respondeu: 1 });
  const { demo } = DemoService.criar({ leadId: lead.id, url: 'https://exemplo/demo' });
  DemoService.marcarEnviada(demo.id);
  DemoService.registrarAcesso(demo.id);

  const depois = ScoreService.recalcular(lead.id);
  assert.ok(depois.score > inicial.score, 'score precisa subir depois da demo acessada');
  assert.ok(depois.motivos.some((m) => /preco/i.test(m.texto)), 'a etiqueta precisa aparecer na justificativa');
  assert.ok(depois.motivos.some((m) => /acessou a demonstracao/i.test(m.texto)));

  const salvo = leadRepo.porId(lead.id);
  assert.equal(salvo.score, depois.score);
  assert.ok(salvo.score_motivos, 'os motivos ficam gravados no lead');
});

/* --------------------------------------------------------------------- 68 */

test('demonstracao percorre o pipeline e move a etapa do lead', () => {
  const { lead } = leadRepo.criarOuEnriquecer({ nome_estabelecimento: 'Clinica Demo', telefone: '16994440000' });
  const { demo, lead: atualizado } = DemoService.criar({ leadId: lead.id, url: 'https://exemplo/clinica' });

  assert.equal(demo.status, 'CRIADA');
  assert.equal(atualizado.pipeline, 'DEMO');

  assert.equal(DemoService.marcarEnviada(demo.id).status, 'ENVIADA');
  const acessada = DemoService.registrarAcesso(demo.id);
  assert.equal(acessada.status, 'ACESSADA');
  assert.equal(acessada.acessos, 1);

  const comFeedback = DemoService.registrarFeedback(demo.id, 'Gostei do layout');
  assert.equal(comFeedback.status, 'FEEDBACK');

  const est = DemoService.estatisticas();
  assert.ok(est.total >= 1 && est.acessadas >= 1);
});

/* --------------------------------------------------------------------- 66 */

test('follow-up so sai depois da confirmacao do operador', async () => {
  const { lead } = leadRepo.criarOuEnriquecer({ nome_estabelecimento: 'Oficina FollowUp', telefone: '16995550000' });

  const fu = FollowUpService.agendar(lead.id, { prazoDias: 1, motivo: 'teste' });
  assert.equal(fu.status, 'PENDENTE');

  // sem Groq a mensagem vem do texto padrao da Skill, mas o fluxo e o mesmo
  const preparado = await FollowUpService.prepararComIA(fu.id);
  assert.equal(preparado.status, 'AGUARDANDO_CONFIRMACAO');
  assert.ok(preparado.mensagem && preparado.mensagem.length > 20);

  // nada foi enviado ainda
  const enviadas = all("SELECT COUNT(*) AS n FROM messages WHERE lead_id = ? AND direcao = 'OUT'", lead.id)[0].n;
  assert.equal(enviadas, 0, 'preparar nao pode enviar');

  const cancelado = FollowUpService.cancelar(fu.id, 'nao quis');
  assert.equal(cancelado.status, 'CANCELADO');
});

test('resposta do cliente cancela os follow-ups pendentes', () => {
  const { lead } = leadRepo.criarOuEnriquecer({ nome_estabelecimento: 'Bar Cancelar', telefone: '16996660000' });
  FollowUpService.agendar(lead.id, { prazoDias: 1 });
  FollowUpService.agendar(lead.id, { prazoDias: 3 });

  const cancelados = FollowUpService.cancelarPendentesDoLead(lead.id);
  assert.equal(cancelados, 2);
  const abertos = all(
    "SELECT COUNT(*) AS n FROM follow_ups WHERE lead_id = ? AND status IN ('PENDENTE','PREPARADO','AGUARDANDO_CONFIRMACAO')",
    lead.id
  )[0].n;
  assert.equal(abertos, 0);
});

/* --------------------------------------------------------------------- 71 */

test('venda fecha o lead e o financeiro bate com as parcelas', () => {
  const { lead } = leadRepo.criarOuEnriquecer({ nome_estabelecimento: 'Loja Venda', telefone: '16997770000' });

  const venda = SalesService.registrar({
    leadId: lead.id,
    valor: 1000,
    forma_pagamento: 'PIX',
    parcelas: [
      { valor: 500, data_prevista: '2026-10-01' },
      { valor: 500, data_prevista: '2026-11-01' }
    ]
  });

  const fechado = leadRepo.porId(lead.id);
  assert.equal(fechado.status, 'FECHADO');
  assert.equal(fechado.pipeline, 'FECHADO');

  const parcelas = SalesService.pagamentos(venda.id);
  assert.equal(parcelas.length, 2, 'nao pode criar parcela extra');

  SalesService.quitarParcela(parcelas[0].id);
  assert.equal(SalesService.porId(venda.id).status, 'PARCIAL');

  SalesService.quitarParcela(parcelas[1].id);
  assert.equal(SalesService.porId(venda.id).status, 'PAGO');

  const m = SalesService.metricas();
  assert.equal(m.recebido, 1000);
  assert.equal(m.pendente, 0);
});

/* --------------------------------------------------------------------- 70 */

test('reativacao encontra quem esfriou e monta campanha explicita', () => {
  const { lead } = leadRepo.criarOuEnriquecer({ nome_estabelecimento: 'Hotel Frio', telefone: '16998880000' });
  leadRepo.atualizar(lead.id, {
    respondeu: 1,
    etiqueta: 'INTERESSADO',
    quantidade_mensagens_enviadas: 1,
    ultima_mensagem_data: '2026-01-01 10:00:00',
    data_ultimo_contato: '2026-01-01 10:00:00'
  });

  const r = ReactivationService.candidatos({ dias: 15 });
  const grupo = r.grupos.find((g) => g.chave === 'interessados_antigos');
  assert.ok(grupo.itens.some((l) => l.id === lead.id), 'o interessado antigo precisa aparecer');

  const campanha = ReactivationService.criarCampanha({ leadIds: [lead.id], nome: 'Reativacao teste' });
  assert.equal(campanha.enfileirados, 1);
  assert.equal(campanha.campanha.tipo, 'REATIVACAO');
  assert.equal(leadRepo.porId(lead.id).pipeline, 'REATIVACAO');
});

/* --------------------------------------------------------------------- 76 */

test('timeline registra a vida do lead em ordem', () => {
  const { lead } = leadRepo.criarOuEnriquecer({ nome_estabelecimento: 'Padaria Timeline', telefone: '16999990000' });
  const { demo } = DemoService.criar({ leadId: lead.id, url: 'https://exemplo/padaria' });
  DemoService.marcarEnviada(demo.id);
  SalesService.registrar({ leadId: lead.id, valor: 800 });

  const tipos = ActivityService.doLead(lead.id).map((a) => a.tipo);
  for (const esperado of ['DEMO_CRIADA', 'DEMO_ENVIADA', 'VENDA']) {
    assert.ok(tipos.includes(esperado), `a timeline precisa ter ${esperado}`);
  }
});

test('notificacoes ficam guardadas e podem ser lidas', () => {
  const antes = ActivityService.naoLidas();
  ActivityService.notificar({ tipo: 'resposta', titulo: 'Teste de notificacao' });
  assert.equal(ActivityService.naoLidas(), antes + 1);
  ActivityService.marcarTodasLidas();
  assert.equal(ActivityService.naoLidas(), 0);
});

/* ------------------------------------------------------------------- 59.18 */

test('busca de leads falha com mensagem clara quando nao ha chave', async () => {
  await assert.rejects(
    () => LeadFinderService.buscar({ nicho: 'BARBEARIAS', cidade: 'Ribeirao Preto', estado: 'SP' }),
    (err) => /GOOGLE_MAPS_API_KEY/i.test(err.message)
  );
});

test('nicho personalizado fica salvo para as proximas buscas', () => {
  const n = prospectRepo.criarNicho('Funilaria e pintura');
  assert.equal(n.slug, 'FUNILARIA_E_PINTURA');
  assert.equal(n.sistema, 0);
  assert.ok(prospectRepo.listarNichos().some((x) => x.slug === 'FUNILARIA_E_PINTURA'));
  // nichos padrao nao podem ser removidos
  assert.throws(() => prospectRepo.excluirNicho('BARBEARIAS'));
});

test.after(() => {
  try {
    whatsapp.provider?.removeAllListeners?.();
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* windows pode manter lock do arquivo do banco */
  }
});
