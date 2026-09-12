import PlacesProvider from './PlacesProvider.js';
import * as prospectRepo from '../../repositories/prospectRepo.js';
import * as leadRepo from '../../repositories/leadRepo.js';
import ActivityService from '../ActivityService.js';
import { classificarSite, prioridadeProspeccao, dominioDe, slugificarNicho } from '../../domain/nichos.js';
import { normalizarTelefone, formatarTelefone } from '../../utils/phone.js';
import { bus, EVENTOS } from '../../realtime/bus.js';
import { logger } from '../../utils/logger.js';
import { AppError } from '../../utils/errors.js';
import { config } from '../../config.js';

/**
 * Encontrar Leads (spec 59).
 *
 * Fluxo: buscar na fonte oficial -> classificar site -> priorizar -> checar
 * duplicidade no CRM -> guardar o resultado -> o operador decide quem entra.
 * Nada e adicionado ao CRM sem clique (spec 59.9 / 59.10).
 */

const FILTROS = {
  todos: () => true,
  sem_site: (r) => r.status_site === 'SEM_SITE',
  sem_site_instagram: (r) => r.status_site === 'SEM_SITE' && Boolean(r.instagram),
  com_site: (r) => r.status_site === 'COM_SITE',
  verificar: (r) => r.status_site === 'VERIFICAR'
};

/** O lead ja existe no CRM? Devolve o contexto para o operador decidir (spec 59.9). */
function checarDuplicidade({ place_id, telefone_e164, site, google_maps, nome, endereco, cidade }) {
  const porNomeEndereco = () => {
    const chave = leadRepo.montarDedupeKey(nome, endereco, cidade);
    return chave ? leadRepo.porDedupeKey(chave) : null;
  };

  const tentativas = [
    ['place_id', () => leadRepo.porPlaceId(place_id)],
    ['telefone', () => (telefone_e164 ? leadRepo.porTelefone(telefone_e164) : null)],
    ['site', () => leadRepo.porDominioSite(dominioDe(site))],
    ['google_maps', () => leadRepo.porGoogleMaps(google_maps)],
    ['nome+endereco', porNomeEndereco]
  ];

  for (const [criterio, fn] of tentativas) {
    const lead = fn();
    if (lead) {
      return {
        duplicado: true,
        criterio,
        lead_id: lead.id,
        status: lead.status,
        etiqueta: lead.etiqueta,
        score: lead.score,
        pipeline: lead.pipeline,
        ultimo_contato: lead.data_ultimo_contato,
        ultima_mensagem: lead.ultima_mensagem,
        contatado: lead.quantidade_mensagens_enviadas > 0
      };
    }
  }
  return { duplicado: false };
}

/** Resolve o nicho (existente ou novo) e devolve { slug, nome, termo }. */
function resolverNicho(entrada) {
  const bruto = String(entrada || '').trim();
  if (!bruto) throw new AppError('Escolha um nicho para a busca.');
  const slug = slugificarNicho(bruto);
  const existente = prospectRepo.nichoPorSlug(slug);
  if (existente) return existente;
  // nicho novo digitado pelo usuario fica salvo para as proximas vezes (spec 59.1)
  return prospectRepo.criarNicho(bruto);
}

export async function buscar({
  nicho,
  cidade,
  estado,
  raioKm = 10,
  filtro = 'todos',
  maximo,
  pesquisaId = null,
  nomePesquisa = null
}) {
  const n = resolverNicho(nicho);
  const teto = Math.min(Number(maximo) || config.places.maxResultados, 60);

  const pesquisa =
    (pesquisaId && prospectRepo.pesquisaPorId(pesquisaId)) ||
    prospectRepo.criarPesquisa({
      nome: nomePesquisa || `${n.nome} · ${cidade || 'sem cidade'}${estado ? ` - ${estado}` : ''}`,
      nicho: n.slug,
      cidade,
      estado,
      raio_km: raioKm,
      filtros: { filtro }
    });

  bus.emit(EVENTOS.BUSCA_PROGRESSO, { fase: 'buscando', nicho: n.nome, cidade });

  const { itens, localizacao, raioAplicado, textQuery } = await PlacesProvider.buscar({
    termo: n.termo || n.nome,
    cidade,
    estado,
    raioKm,
    maximo: teto
  });

  prospectRepo.contarBusca(n.slug);

  const processados = itens.map((place) => {
    const site = classificarSite(place.website);
    const telefone_e164 = normalizarTelefone(place.telefone);
    const prioridade = prioridadeProspeccao({
      status_site: site.status,
      telefone: telefone_e164,
      instagram: site.instagram,
      total_avaliacoes: place.total_avaliacoes
    });

    const registro = {
      search_id: pesquisa.id,
      place_id: place.place_id,
      nome: place.nome || 'Estabelecimento sem nome',
      categoria: place.categoria,
      endereco: place.endereco,
      cidade: place.cidade || cidade || null,
      estado: place.estado || estado || null,
      telefone: place.telefone,
      telefone_e164,
      google_maps: place.google_maps,
      site: site.site,
      instagram: site.instagram,
      avaliacao: place.avaliacao,
      total_avaliacoes: place.total_avaliacoes,
      status_site: site.status,
      prioridade: prioridade.prioridade,
      nicho: n.slug,
      origem: 'google_places',
      bruto: place
    };

    const salvo = prospectRepo.salvarResultado(registro);
    const dup = checarDuplicidade({ ...registro, nome: registro.nome });

    return {
      ...salvo,
      telefone_formatado: telefone_e164 ? formatarTelefone(telefone_e164) : null,
      motivo_site: site.motivo,
      motivo_prioridade: prioridade.motivo,
      nicho_nome: n.nome,
      ...dup
    };
  });

  prospectRepo.registrarExecucao(pesquisa.id, processados.length);

  const filtrados = processados.filter(FILTROS[filtro] || FILTROS.todos);

  const resumo = {
    total: processados.length,
    exibidos: filtrados.length,
    sem_site: processados.filter((r) => r.status_site === 'SEM_SITE').length,
    com_site: processados.filter((r) => r.status_site === 'COM_SITE').length,
    verificar: processados.filter((r) => r.status_site === 'VERIFICAR').length,
    duplicados: processados.filter((r) => r.duplicado).length,
    com_telefone: processados.filter((r) => r.telefone_e164).length
  };

  logger.ok(
    'prospeccao',
    `Busca "${textQuery}": ${resumo.total} encontrados, ${resumo.sem_site} sem site, ${resumo.duplicados} ja no CRM.`
  );
  bus.emit(EVENTOS.BUSCA_PROGRESSO, { fase: 'concluido', ...resumo });

  return {
    pesquisa: prospectRepo.pesquisaPorId(pesquisa.id),
    itens: filtrados,
    resumo,
    localizacao,
    raioAplicado,
    consulta: textQuery
  };
}

/** Adiciona um resultado da busca ao CRM (spec 59.9). */
export function adicionarAoCrm(resultadoId, { forcar = false } = {}) {
  const r = prospectRepo.resultadoPorId(resultadoId);
  if (!r) throw new AppError('Resultado da busca nao encontrado.', 404);

  const dup = checarDuplicidade({
    place_id: r.place_id,
    telefone_e164: r.telefone_e164,
    site: r.site,
    google_maps: r.google_maps,
    nome: r.nome,
    endereco: r.endereco,
    cidade: r.cidade
  });

  if (dup.duplicado && !forcar) {
    prospectRepo.marcarResultadoAdicionado(r.id, dup.lead_id);
    return { acao: 'DUPLICADO', ...dup, resultado: r };
  }

  const { acao, lead } = leadRepo.criarOuEnriquecer(
    {
      nome_estabelecimento: r.nome,
      telefone: r.telefone_e164 || r.telefone,
      google_maps: r.google_maps,
      endereco: r.endereco,
      cidade: r.cidade,
      estado: r.estado,
      instagram: r.instagram,
      categoria: r.categoria,
      site: r.site,
      nicho: r.nicho,
      place_id: r.place_id,
      avaliacao: r.avaliacao,
      total_avaliacoes: r.total_avaliacoes,
      status_site: r.status_site,
      search_id: r.search_id,
      descoberto_em: new Date().toISOString()
    },
    'GOOGLE_MAPS'
  );

  prospectRepo.marcarResultadoAdicionado(r.id, lead.id);

  if (acao === 'CRIADO') {
    ActivityService.registrar({
      lead_id: lead.id,
      tipo: 'LEAD_ENCONTRADO',
      descricao: `Encontrado na busca de ${r.nicho?.toLowerCase?.() || 'leads'}${r.cidade ? ` em ${r.cidade}` : ''}. ${
        r.status_site === 'SEM_SITE' ? 'Site proprio nao identificado.' : ''
      }`.trim(),
      meta: { place_id: r.place_id, search_id: r.search_id, origem: 'google_places' }
    });
  }

  return { acao, lead, resultado: r, duplicado: dup.duplicado, criterio: dup.criterio };
}

/** Adiciona varios de uma vez, com progresso em tempo real (spec 59.10). */
export function adicionarVarios(ids = [], { forcar = false } = {}) {
  const resumo = { total: ids.length, adicionados: 0, duplicados: 0, erros: 0, leads: [] };

  ids.forEach((id, i) => {
    try {
      const r = adicionarAoCrm(id, { forcar });
      if (r.acao === 'CRIADO') {
        resumo.adicionados += 1;
        resumo.leads.push(r.lead.id);
      } else resumo.duplicados += 1;
    } catch (err) {
      resumo.erros += 1;
      logger.warn('prospeccao', `Falha ao adicionar resultado ${id}: ${err.message}`);
    }
    bus.emit(EVENTOS.BUSCA_PROGRESSO, { fase: 'adicionando', atual: i + 1, total: ids.length, ...resumo });
  });

  if (resumo.adicionados) {
    ActivityService.notificar({
      tipo: 'leads',
      titulo: `${resumo.adicionados} lead(s) adicionados ao CRM`,
      texto: resumo.duplicados ? `${resumo.duplicados} ja existiam e foram ignorados.` : null,
      rota: '/leads'
    });
  }
  bus.emit(EVENTOS.STATS, {});
  logger.ok('prospeccao', `${resumo.adicionados} adicionados, ${resumo.duplicados} duplicados, ${resumo.erros} erros.`);
  return resumo;
}

export const status = () => PlacesProvider.verificarConexao();

export default { buscar, adicionarAoCrm, adicionarVarios, status };
