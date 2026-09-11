import ExcelJS from 'exceljs';
import path from 'node:path';
import fs from 'node:fs';
import { run, all, tx } from '../db/index.js';
import * as leadRepo from '../repositories/leadRepo.js';
import { mapearColunas, CAMPOS } from '../utils/columnMap.js';
import { normalizarTelefone, formatarTelefone } from '../utils/phone.js';
import { bus, EVENTOS } from '../realtime/bus.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

/** Celula do ExcelJS pode vir como objeto (hyperlink, richText, formula). */
function valorCelula(cell) {
  const v = cell?.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.text) return String(v.text).trim();
    if (v.hyperlink) return String(v.hyperlink).trim();
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('').trim();
    if (v.result !== undefined) return String(v.result).trim();
    if (v instanceof Date) return v.toISOString();
    return '';
  }
  return String(v).trim();
}

async function carregarPlanilha(arquivo) {
  const wb = new ExcelJS.Workbook();
  const ext = path.extname(arquivo).toLowerCase();
  try {
    if (ext === '.csv') await wb.csv.readFile(arquivo);
    else await wb.xlsx.readFile(arquivo);
  } catch (err) {
    throw new AppError(`Nao foi possivel ler a planilha: ${err.message}`, 400);
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new AppError('A planilha esta vazia.', 400);
  return ws;
}

/** Le a planilha e devolve cabecalhos + linhas cruas. */
function extrairLinhas(ws) {
  const linhas = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const valores = [];
    const total = Math.max(row.cellCount, row.actualCellCount);
    for (let c = 1; c <= total; c += 1) valores.push(valorCelula(row.getCell(c)));
    if (valores.some((v) => v !== '')) linhas.push(valores);
  });
  if (!linhas.length) throw new AppError('A planilha nao tem nenhuma linha preenchida.', 400);

  // A primeira linha com 2+ textos e tratada como cabecalho.
  let idxCabecalho = 0;
  for (let i = 0; i < Math.min(linhas.length, 10); i += 1) {
    const preenchidas = linhas[i].filter((v) => v !== '').length;
    if (preenchidas >= 2) {
      idxCabecalho = i;
      break;
    }
  }
  const cabecalhos = linhas[idxCabecalho];
  const dados = linhas.slice(idxCabecalho + 1);
  return { cabecalhos, dados };
}

/** Analise previa (mostrar mapeamento antes de importar). */
export async function analisar(arquivo) {
  const ws = await carregarPlanilha(arquivo);
  const { cabecalhos, dados } = extrairLinhas(ws);
  const amostras = cabecalhos.map((_, i) => dados.slice(0, 25).map((l) => l[i]));
  const mapa = mapearColunas(cabecalhos, amostras);

  const colunas = cabecalhos.map((cab, i) => ({
    indice: i,
    cabecalho: cab || `(coluna ${i + 1})`,
    campo: mapa[i] || null,
    exemplo: (amostras[i] || []).find((v) => v) || ''
  }));

  return {
    totalLinhas: dados.length,
    colunas,
    camposDetectados: Object.values(mapa),
    camposAusentes: CAMPOS.filter((c) => !Object.values(mapa).includes(c)),
    previa: dados.slice(0, 5).map((linha) => {
      const obj = {};
      for (const [i, campo] of Object.entries(mapa)) obj[campo] = linha[Number(i)] || '';
      return obj;
    })
  };
}

/**
 * Importa a planilha. Duplicidade: telefone primeiro, nome+endereco como
 * fallback (spec 39). Nada e inventado: campo ausente fica vazio (spec 52).
 */
export async function importar(arquivo, { nomeOriginal = null, mapaManual = null } = {}) {
  const ws = await carregarPlanilha(arquivo);
  const { cabecalhos, dados } = extrairLinhas(ws);
  const amostras = cabecalhos.map((_, i) => dados.slice(0, 25).map((l) => l[i]));
  const mapa = mapaManual && Object.keys(mapaManual).length ? mapaManual : mapearColunas(cabecalhos, amostras);

  if (!Object.values(mapa).includes('nome_estabelecimento') && !Object.values(mapa).includes('telefone')) {
    throw new AppError(
      'Nao encontrei nenhuma coluna de nome do estabelecimento nem de telefone. Confira o cabecalho da planilha.',
      400
    );
  }

  const resumo = { total: dados.length, importados: 0, duplicados: 0, atualizados: 0, invalidos: 0 };
  const criados = [];

  tx(() => {
    for (const linha of dados) {
      const dadosLead = {};
      const extra = {};
      cabecalhos.forEach((cab, i) => {
        const valor = linha[i];
        if (valor === undefined || valor === '') return;
        const campo = mapa[i];
        if (campo) dadosLead[campo] = valor;
        else if (cab) extra[cab] = valor;
      });

      const telefone = normalizarTelefone(dadosLead.telefone);
      let nome = String(dadosLead.nome_estabelecimento || '').trim();

      if (!nome && telefone) {
        // Sem nome na planilha: usa o proprio telefone como rotulo (nao inventa nome).
        nome = formatarTelefone(telefone);
        dadosLead.observacoes = [dadosLead.observacoes, 'Nome ausente na planilha.'].filter(Boolean).join(' | ');
      }
      if (!nome && !telefone) {
        resumo.invalidos += 1;
        continue;
      }

      const { acao, lead } = leadRepo.criarOuEnriquecer(
        {
          ...dadosLead,
          nome_estabelecimento: nome,
          telefone: dadosLead.telefone || telefone,
          dados_extra: Object.keys(extra).length ? extra : null
        },
        nomeOriginal ? `XLSX:${nomeOriginal}` : 'XLSX'
      );

      if (acao === 'CRIADO') {
        resumo.importados += 1;
        criados.push(lead.id);
      } else if (acao === 'ATUALIZADO') resumo.atualizados += 1;
      else resumo.duplicados += 1;
    }

    run(
      `INSERT INTO imports (arquivo, total_linhas, importados, duplicados, invalidos, atualizados, mapeamento)
       VALUES (?,?,?,?,?,?,?)`,
      nomeOriginal || path.basename(arquivo),
      resumo.total,
      resumo.importados,
      resumo.duplicados,
      resumo.invalidos,
      resumo.atualizados,
      JSON.stringify(
        Object.fromEntries(Object.entries(mapa).map(([i, campo]) => [cabecalhos[Number(i)] || `col${i}`, campo]))
      )
    );
  });

  logger.ok(
    'import',
    `Planilha processada: ${resumo.importados} novos, ${resumo.atualizados} enriquecidos, ${resumo.duplicados} duplicados, ${resumo.invalidos} invalidos.`
  );
  bus.emit(EVENTOS.IMPORTACAO, resumo);
  bus.emit(EVENTOS.STATS, {});

  return {
    ...resumo,
    mapeamento: Object.fromEntries(
      Object.entries(mapa).map(([i, campo]) => [cabecalhos[Number(i)] || `coluna ${Number(i) + 1}`, campo])
    ),
    camposAusentes: CAMPOS.filter((c) => !Object.values(mapa).includes(c))
  };
}

export function historicoImportacoes(limite = 20) {
  return all('SELECT * FROM imports ORDER BY id DESC LIMIT ?', Math.min(Number(limite) || 20, 100));
}

export function removerArquivo(arquivo) {
  try {
    fs.unlinkSync(arquivo);
  } catch {
    /* arquivo temporario pode ja ter sido removido */
  }
}

export default { analisar, importar, removerArquivo, historicoImportacoes };
