import { Router } from 'express';
import SalesService from '../services/SalesService.js';
import { AppError, naoEncontrado } from '../utils/errors.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    itens: SalesService.listar({ status: req.query.status, limite: req.query.limite }),
    metricas: SalesService.metricas(),
    serie: SalesService.serieFaturamento(Number(req.query.meses) || 6),
    status_venda: SalesService.STATUS_VENDA
  });
});

router.get('/metricas', (req, res) => res.json(SalesService.metricas()));

router.get('/:id', (req, res) => {
  const venda = SalesService.porId(req.params.id);
  if (!venda) throw naoEncontrado('Venda');
  res.json({ venda, pagamentos: SalesService.pagamentos(venda.id) });
});

router.post('/', (req, res) => {
  const { leadId, valor } = req.body || {};
  if (!leadId) throw new AppError('Informe o lead da venda.');
  if (!valor) throw new AppError('Informe o valor da venda.');
  res.status(201).json(SalesService.registrar({ ...req.body, leadId: Number(leadId) }));
});

router.patch('/:id', (req, res) => res.json(SalesService.atualizar(Number(req.params.id), req.body || {})));

router.post('/:id/pagamentos', (req, res) => {
  const { valor } = req.body || {};
  if (!valor) throw new AppError('Informe o valor do pagamento.');
  res.status(201).json(SalesService.registrarPagamento({ ...req.body, saleId: Number(req.params.id) }));
});

/** Marca uma parcela ja prevista como recebida. */
router.post('/pagamentos/:paymentId/quitar', (req, res) =>
  res.json(SalesService.quitarParcela(Number(req.params.paymentId), req.body || {}))
);

router.delete('/pagamentos/:paymentId', (req, res) =>
  res.json(SalesService.excluirParcela(Number(req.params.paymentId)))
);

router.delete('/:id', (req, res) => res.json(SalesService.excluir(Number(req.params.id))));

export default router;
