/**
 * Importacao de planilhas no formato das listas do Google Maps e horario
 * automatico da prospeccao.
 *
 * A fixture leads-maps-tabela.xlsx e sintetica (nenhum dado real) e reproduz o
 * que quebrava: Tabela do Excel com caminho absoluto, aba de resumo antes da
 * aba de leads e colunas como "Categoria Maps" e "Site exibido no Maps".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'henvix-import-'));
process.env.DATABASE_URL = path.join(tmp, 'teste.db');
process.env.WA_SESSION_DIR = path.join(tmp, 'wa');
process.env.GROQ_API_KEY = '';

const { migrar, get } = await import('../server/db/index.js');
migrar();
const { default: ImportService } = await import('../server/services/ImportService.js');
const { mapearColunas, statusSiteDoValor } = await import('../server/utils/columnMap.js');
const { dentroDaJanela, msAteAbrir, normalizarHorario } = await import('../server/utils/horario.js');

const aqui = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(aqui, 'fixtures', 'leads-maps-tabela.xlsx');

test('planilha com Tabela do Excel em caminho absoluto abre e importa', async () => {
  const r = await ImportService.importar(fixture, { nomeOriginal: 'leads-maps-tabela.xlsx' });
  assert.equal(r.total, 2, 'usa a aba "Leads", nao a de resumo');
  assert.equal(r.importados, 2);

  const lead = get("SELECT * FROM leads WHERE nome_estabelecimento = 'Barbearia Teste Um'");
  assert.equal(lead.telefone_e164, '5516997010001');
  assert.equal(lead.categoria, 'Barbearia');
  assert.equal(lead.nicho, 'Barbearias');
  assert.equal(lead.estado, 'SP');
  assert.equal(lead.avaliacao, 4.8);
  assert.equal(lead.total_avaliacoes, 1234);
  assert.equal(lead.status_site, 'SEM_SITE');
  assert.equal(lead.site, null, '"Nao" nunca vira endereco de site');
  assert.equal(lead.google_maps, 'https://www.google.com/maps/place/Barbearia+Teste+Um');
});

test('cabecalhos compostos nao caem no campo errado', () => {
  const cab = ['Nicho', 'Nome', 'Categoria Maps', 'Telefone', 'Site exibido no Maps', 'Status de contato', 'Consulta no Maps', 'URL Google Maps'];
  const amostras = [
    ['Barbearias'], ['Barbearia X'], ['Barbearia'], ['(16) 99701-0001'], ['Não'],
    ['Pronto para contato'], ['barbearia em Franca, SP'], ['https://www.google.com/maps/place/X']
  ];
  const mapa = mapearColunas(cab, amostras);
  assert.deepEqual(Object.fromEntries(Object.entries(mapa).map(([i, c]) => [cab[i], c])), {
    Nicho: 'nicho',
    Nome: 'nome_estabelecimento',
    'Categoria Maps': 'categoria',
    Telefone: 'telefone',
    'Site exibido no Maps': 'status_site',
    'URL Google Maps': 'google_maps'
  });
});

test('coluna "Site" com Sim/Nao vira status do site', () => {
  const mapa = mapearColunas(['Nome', 'Site'], [['A', 'B'], ['Não', 'Sim']]);
  assert.equal(mapa[1], 'status_site');
  assert.equal(statusSiteDoValor('Não'), 'SEM_SITE');
  assert.equal(statusSiteDoValor('Sim'), 'COM_SITE');
  assert.equal(statusSiteDoValor('talvez'), null);
});

test('planilha so com cabecalho avisa em vez de registrar importacao vazia', async () => {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Leads').addRow(['Nome', 'Telefone']);
  const arq = path.join(tmp, 'vazia.xlsx');
  await wb.xlsx.writeFile(arq);
  await assert.rejects(() => ImportService.importar(arq), /so tem o cabecalho/);
});

// ------------------------------------------------------------ horario automatico
const brasilia = (hhmm) => new Date(`2026-09-16T${hhmm}:00-03:00`);

test('janela de envio usa o horario de Brasilia', () => {
  assert.equal(dentroDaJanela('08:00', '18:00', brasilia('07:59')), false);
  assert.equal(dentroDaJanela('08:00', '18:00', brasilia('08:00')), true);
  assert.equal(dentroDaJanela('08:00', '18:00', brasilia('17:59')), true);
  assert.equal(dentroDaJanela('08:00', '18:00', brasilia('18:00')), false);
  // sem horario definido: envia a qualquer hora (comportamento antigo)
  assert.equal(dentroDaJanela(null, null, brasilia('03:00')), true);
});

test('janela que vira a noite (22:00 as 02:00)', () => {
  assert.equal(dentroDaJanela('22:00', '02:00', brasilia('23:30')), true);
  assert.equal(dentroDaJanela('22:00', '02:00', brasilia('01:00')), true);
  assert.equal(dentroDaJanela('22:00', '02:00', brasilia('12:00')), false);
});

test('fora do horario calcula quanto falta para o proximo inicio', () => {
  assert.equal(msAteAbrir('08:00', '18:00', brasilia('10:00')), 0);
  assert.equal(msAteAbrir('08:00', '18:00', brasilia('07:00')), 60 * 60_000);
  assert.equal(msAteAbrir('08:00', '18:00', brasilia('18:00')), 14 * 60 * 60_000, 'termina as 18h e volta amanha as 8h');
});

test('horario aceita "8", "8h" e "08:00"', () => {
  assert.equal(normalizarHorario('8'), '08:00');
  assert.equal(normalizarHorario('8h'), '08:00');
  assert.equal(normalizarHorario('18:30'), '18:30');
  assert.equal(normalizarHorario('25:00'), null);
});
