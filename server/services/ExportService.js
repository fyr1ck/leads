import ExcelJS from 'exceljs';
import path from 'node:path';
import { all, get } from '../db/index.js';
import { paths } from '../config.js';
import * as leadRepo from '../repositories/leadRepo.js';
import * as historyRepo from '../repositories/historyRepo.js';
import { formatarTelefone } from '../utils/phone.js';
import { TAGS_POR_SLUG } from '../domain/classificacao.js';
import { logger } from '../utils/logger.js';

const etiquetaLegivel = (slug) => (slug ? `${TAGS_POR_SLUG[slug]?.emoji || ''} ${TAGS_POR_SLUG[slug]?.nome || slug}`.trim() : '');

function novaPlanilha(nomeAba, colunas) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Henvix Sales Panel';
  wb.created = new Date();
  const ws = wb.addWorksheet(nomeAba, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = colunas;
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  ws.autoFilter = { from: 'A1', to: { row: 1, column: colunas.length } };
  return { wb, ws };
}

async function salvar(wb, nomeArquivo) {
  const destino = path.join(paths.exports, nomeArquivo);
  await wb.xlsx.writeFile(destino);
  logger.ok('export', `Arquivo gerado: ${nomeArquivo}`);
  return destino;
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

/** [EXPORTAR LEADS RESTANTES] - so quem ainda nao foi trabalhado (spec 12). */
export async function exportarRestantes() {
  const leads = leadRepo.restantes();
  const { wb, ws } = novaPlanilha('Leads restantes', [
    { header: 'Nome do estabelecimento', key: 'nome', width: 38 },
    { header: 'Telefone', key: 'telefone', width: 20 },
    { header: 'Google Maps', key: 'maps', width: 45 },
    { header: 'Cidade', key: 'cidade', width: 20 },
    { header: 'Categoria', key: 'categoria', width: 22 },
    { header: 'Endereco', key: 'endereco', width: 40 },
    { header: 'Instagram', key: 'instagram', width: 28 },
    { header: 'Site', key: 'site', width: 28 },
    { header: 'Importado em', key: 'importado', width: 20 }
  ]);
  for (const l of leads) {
    ws.addRow({
      nome: l.nome_estabelecimento,
      telefone: l.telefone_e164 ? formatarTelefone(l.telefone_e164) : l.telefone || '',
      maps: l.google_maps || '',
      cidade: l.cidade || '',
      categoria: l.categoria || '',
      endereco: l.endereco || '',
      instagram: l.instagram || '',
      site: l.site || '',
      importado: l.data_importacao || ''
    });
  }
  return { arquivo: await salvar(wb, `leads-restantes-${stamp()}.xlsx`), total: leads.length };
}

/**
 * [EXPORTAR HISTORICO] - tudo que ja foi trabalhado.
 * Preserva sempre nome do estabelecimento + Google Maps (spec 12).
 */
export async function exportarHistorico() {
  const historico = historyRepo.listar({ limite: 20000 }).itens;
  const { wb, ws } = novaPlanilha('Historico de contatos', [
    { header: 'Data', key: 'data', width: 20 },
    { header: 'Tipo', key: 'tipo', width: 14 },
    { header: 'Estabelecimento', key: 'nome', width: 38 },
    { header: 'Google Maps', key: 'maps', width: 45 },
    { header: 'Telefone', key: 'telefone', width: 20 },
    { header: 'Cidade', key: 'cidade', width: 18 },
    { header: 'Campanha', key: 'campanha', width: 24 },
    { header: 'Etiqueta', key: 'etiqueta', width: 24 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Mensagem enviada', key: 'mensagem', width: 60 },
    { header: 'Resposta / motivo', key: 'resposta', width: 60 }
  ]);
  for (const h of historico) {
    ws.addRow({
      data: h.created_at,
      tipo: h.tipo,
      nome: h.estabelecimento || '',
      maps: h.google_maps || '',
      telefone: h.telefone ? formatarTelefone(h.telefone) : '',
      cidade: h.cidade || '',
      campanha: h.campanha_nome || '',
      etiqueta: etiquetaLegivel(h.etiqueta),
      status: h.status || '',
      mensagem: h.mensagem || '',
      resposta: h.resposta || ''
    });
  }
  return { arquivo: await salvar(wb, `historico-contatos-${stamp()}.xlsx`), total: historico.length };
}

/** CRM completo: todo lead ja contatado/respondido, com etiqueta e potencial. */
export async function exportarCrm() {
  const leads = leadRepo.trabalhados();
  const { wb, ws } = novaPlanilha('CRM', [
    { header: 'Nome do estabelecimento', key: 'nome', width: 38 },
    { header: 'Google Maps', key: 'maps', width: 45 },
    { header: 'Telefone', key: 'telefone', width: 20 },
    { header: 'Cidade', key: 'cidade', width: 18 },
    { header: 'Categoria', key: 'categoria', width: 22 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Etiqueta', key: 'etiqueta', width: 26 },
    { header: 'Prioridade', key: 'prioridade', width: 14 },
    { header: 'Potencial (0-100)', key: 'score', width: 16 },
    { header: 'Etapa', key: 'pipeline', width: 16 },
    { header: 'Mensagens enviadas', key: 'qtd', width: 18 },
    { header: 'Respondeu', key: 'respondeu', width: 12 },
    { header: 'Ultimo contato', key: 'ultimo', width: 20 },
    { header: 'Ultima mensagem', key: 'ultimaMsg', width: 60 }
  ]);
  for (const l of leads) {
    ws.addRow({
      nome: l.nome_estabelecimento,
      maps: l.google_maps || '',
      telefone: l.telefone_e164 ? formatarTelefone(l.telefone_e164) : l.telefone || '',
      cidade: l.cidade || '',
      categoria: l.categoria || '',
      status: l.status,
      etiqueta: etiquetaLegivel(l.etiqueta),
      prioridade: l.prioridade || '',
      score: l.score ?? 0,
      pipeline: l.pipeline,
      qtd: l.quantidade_mensagens_enviadas,
      respondeu: l.respondeu ? 'SIM' : 'NAO',
      ultimo: l.data_ultimo_contato || '',
      ultimaMsg: l.ultima_mensagem || ''
    });
  }
  return { arquivo: await salvar(wb, `crm-henvix-${stamp()}.xlsx`), total: leads.length };
}

/**
 * Resultados de uma busca de leads (spec 59.11).
 * Gera SEMPRE um arquivo novo: a planilha original de prospeccao nunca e tocada.
 */
export async function exportarResultadosBusca(searchId) {
  const pesquisa = get('SELECT * FROM saved_searches WHERE id = ?', searchId);
  const resultados = all('SELECT * FROM search_results WHERE search_id = ? ORDER BY id ASC', searchId);

  const { wb, ws } = novaPlanilha('Resultados da busca', [
    { header: 'Estabelecimento', key: 'nome', width: 38 },
    { header: 'Nicho', key: 'nicho', width: 20 },
    { header: 'Cidade', key: 'cidade', width: 20 },
    { header: 'Estado', key: 'estado', width: 10 },
    { header: 'Telefone', key: 'telefone', width: 20 },
    { header: 'Google Maps', key: 'maps', width: 45 },
    { header: 'Site', key: 'site', width: 30 },
    { header: 'Instagram', key: 'instagram', width: 28 },
    { header: 'Avaliacao', key: 'avaliacao', width: 12 },
    { header: 'Qtd. avaliacoes', key: 'total_avaliacoes', width: 16 },
    { header: 'Status do site', key: 'status_site', width: 22 },
    { header: 'Prioridade', key: 'prioridade', width: 12 },
    { header: 'Data da pesquisa', key: 'data', width: 20 },
    { header: 'Origem', key: 'origem', width: 16 },
    { header: 'Status do lead', key: 'status_lead', width: 16 },
    { header: 'Score', key: 'score', width: 10 }
  ]);

  const ROTULOS = { SEM_SITE: 'Site nao identificado', COM_SITE: 'Site identificado', VERIFICAR: 'Verificar manualmente' };

  for (const r of resultados) {
    const lead = r.lead_id ? get('SELECT status, score FROM leads WHERE id = ?', r.lead_id) : null;
    ws.addRow({
      nome: r.nome,
      nicho: r.nicho || '',
      cidade: r.cidade || '',
      estado: r.estado || '',
      telefone: r.telefone_e164 ? formatarTelefone(r.telefone_e164) : r.telefone || '',
      maps: r.google_maps || '',
      site: r.site || 'Nao identificado',
      instagram: r.instagram || '',
      avaliacao: r.avaliacao ?? '',
      total_avaliacoes: r.total_avaliacoes ?? '',
      status_site: ROTULOS[r.status_site] || r.status_site || '',
      prioridade: r.prioridade || '',
      data: r.created_at,
      origem: r.origem || 'google_places',
      status_lead: lead?.status || (r.adicionado ? 'ADICIONADO' : 'NAO ADICIONADO'),
      score: lead?.score ?? ''
    });
  }

  const nome = `busca-${(pesquisa?.nicho || 'leads').toLowerCase()}-${stamp()}.xlsx`;
  return { arquivo: await salvar(wb, nome), total: resultados.length };
}

export default { exportarRestantes, exportarHistorico, exportarCrm, exportarResultadosBusca };
