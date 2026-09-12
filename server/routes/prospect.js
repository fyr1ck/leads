import { Router } from 'express';
import LeadFinderService from '../services/prospect/LeadFinderService.js';
import * as prospectRepo from '../repositories/prospectRepo.js';
import ExportService from '../services/ExportService.js';
import { asyncHandler } from '../middleware/index.js';
import { AppError, naoEncontrado } from '../utils/errors.js';
import { ROTULO_SITE } from '../domain/nichos.js';

const router = Router();

/** Status da integracao + catalogo de nichos (spec 59.1). */
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    res.json({
      fonte: 'Google Places API (New)',
      ...(await LeadFinderService.status()),
      rotulos_site: ROTULO_SITE
    });
  })
);

router.get('/nichos', (req, res) => res.json(prospectRepo.listarNichos()));

router.post('/nichos', (req, res) => {
  const nicho = prospectRepo.criarNicho(req.body?.nome, req.body?.termo);
  res.status(201).json(nicho);
});

router.delete('/nichos/:slug', (req, res) => res.json(prospectRepo.excluirNicho(req.params.slug)));

/** A busca em si (spec 59.3). */
router.post(
  '/buscar',
  asyncHandler(async (req, res) => {
    const { nicho, cidade, estado, raioKm, filtro, maximo, pesquisaId, nomePesquisa } = req.body || {};
    if (!nicho) throw new AppError('Escolha um nicho para a busca.');
    res.json(
      await LeadFinderService.buscar({
        nicho,
        cidade,
        estado,
        raioKm: Number(raioKm) || 10,
        filtro: filtro || 'todos',
        maximo: Number(maximo) || undefined,
        pesquisaId: pesquisaId ? Number(pesquisaId) : null,
        nomePesquisa
      })
    );
  })
);

/* ------------------------------------------------------- pesquisas salvas */

router.get('/pesquisas', (req, res) => res.json(prospectRepo.listarPesquisas()));

router.get('/pesquisas/:id', (req, res) => {
  const p = prospectRepo.pesquisaPorId(req.params.id);
  if (!p) throw naoEncontrado('Pesquisa');
  res.json({ pesquisa: p, resultados: prospectRepo.resultadosDaPesquisa(p.id) });
});

router.patch('/pesquisas/:id', (req, res) => {
  const p = prospectRepo.pesquisaPorId(req.params.id);
  if (!p) throw naoEncontrado('Pesquisa');
  res.json(prospectRepo.atualizarPesquisa(p.id, req.body || {}));
});

/** Duplicar uma pesquisa salva (spec 59.14). */
router.post('/pesquisas/:id/duplicar', (req, res) => {
  const p = prospectRepo.pesquisaPorId(req.params.id);
  if (!p) throw naoEncontrado('Pesquisa');
  const nova = prospectRepo.criarPesquisa({
    nome: `${p.nome} (copia)`,
    nicho: p.nicho,
    cidade: p.cidade,
    estado: p.estado,
    raio_km: p.raio_km,
    filtros: p.filtros ? JSON.parse(p.filtros) : null
  });
  res.status(201).json(nova);
});

router.delete('/pesquisas/:id', (req, res) => res.json(prospectRepo.excluirPesquisa(req.params.id)));

/* ------------------------------------------------------- adicionar ao CRM */

router.post('/adicionar', (req, res) => {
  const { resultadoId, forcar = false } = req.body || {};
  if (!resultadoId) throw new AppError('Informe o resultado que deve ser adicionado.');
  res.json(LeadFinderService.adicionarAoCrm(Number(resultadoId), { forcar }));
});

/** Selecao multipla (spec 59.10). */
router.post('/adicionar-varios', (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  if (!ids.length) throw new AppError('Selecione pelo menos um estabelecimento.');
  res.json(LeadFinderService.adicionarVarios(ids, { forcar: Boolean(req.body?.forcar) }));
});

/** Exportacao dos resultados da busca (spec 59.11) - gera arquivo novo. */
router.get(
  '/pesquisas/:id/export',
  asyncHandler(async (req, res) => {
    const p = prospectRepo.pesquisaPorId(req.params.id);
    if (!p) throw naoEncontrado('Pesquisa');
    const { arquivo } = await ExportService.exportarResultadosBusca(p.id);
    res.download(arquivo, (err) => {
      if (err && !res.headersSent) res.status(500).json({ erro: 'Nao foi possivel enviar o arquivo.' });
    });
  })
);

export default router;
