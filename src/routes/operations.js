import { Router } from 'express';
import * as ops from '../controllers/operationsController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFinancePermission, resolveWorkspaceContext } from '../middleware/workspaceContext.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validation.js';
import * as schemas from '../validators/operations.js';

/** PAINEL R2 routers: invoices, card sales, bank entries, recurrences and revenues. */

const scoped = () => {
  const router = Router();
  router.use(requireAuth);
  router.use(resolveWorkspaceContext);
  return router;
};

const can = (resource, action = null) => requireFinancePermission(resource, action ? () => action : null);
const byId = { params: schemas.idParamSchema };

// /api/invoices
export const invoiceRoutes = scoped();
invoiceRoutes.get('/', can('financeiro.faturas'), validate({ query: schemas.listInvoicesQuerySchema }), asyncHandler(ops.listInvoices));
invoiceRoutes.get('/summary', can('financeiro.cartoes'), asyncHandler(ops.getCardsSummary));
invoiceRoutes.delete('/payments/:id', can('financeiro.faturas', 'excluir'), validate(byId), asyncHandler(ops.deleteInvoicePayment));
invoiceRoutes.get('/:id', can('financeiro.faturas'), validate(byId), asyncHandler(ops.getInvoice));
invoiceRoutes.post('/:id/payments', can('financeiro.faturas', 'pagar'),
  validate({ ...byId, body: schemas.invoicePaymentSchema }), asyncHandler(ops.payInvoice));

// /api/card-sales
export const cardSaleRoutes = scoped();
const sales = 'financeiro.vendas_cartao';
cardSaleRoutes.get('/', can(sales), validate({ query: schemas.listCardSalesQuerySchema }), asyncHandler(ops.listCardSales));
cardSaleRoutes.post('/', can(sales), validate({ body: schemas.createCardSaleSchema }), asyncHandler(ops.createCardSale));
cardSaleRoutes.post('/installments/:id/credit', can(sales, 'creditar'),
  validate({ ...byId, body: schemas.creditInstallmentSchema }), asyncHandler(ops.creditCardSaleInstallment));
cardSaleRoutes.delete('/installments/:id/credit', can(sales, 'creditar'), validate(byId), asyncHandler(ops.undoCardSaleCredit));
cardSaleRoutes.get('/:id', can(sales), validate(byId), asyncHandler(ops.getCardSale));
cardSaleRoutes.put('/:id', can(sales), validate({ ...byId, body: schemas.updateCardSaleSchema }), asyncHandler(ops.updateCardSale));
cardSaleRoutes.delete('/:id', can(sales), validate(byId), asyncHandler(ops.deleteCardSale));

// /api/bank-entries
export const bankEntryRoutes = scoped();
const entries = 'financeiro.entradas';
bankEntryRoutes.get('/', can(entries), validate({ query: schemas.listBankEntriesQuerySchema }), asyncHandler(ops.listBankEntries));
bankEntryRoutes.post('/', can(entries), validate({ body: schemas.createBankEntrySchema }), asyncHandler(ops.createBankEntry));
bankEntryRoutes.put('/:id', can(entries), validate({ ...byId, body: schemas.updateBankEntrySchema }), asyncHandler(ops.updateBankEntry));
bankEntryRoutes.delete('/:id', can(entries), validate(byId), asyncHandler(ops.deleteBankEntry));

// /api/recurrences
export const recurrenceRoutes = scoped();
const recurrences = 'financeiro.recorrencias';
recurrenceRoutes.get('/', can(recurrences), validate({ query: schemas.listRecurrencesQuerySchema }), asyncHandler(ops.listRecurrences));
recurrenceRoutes.get('/month', can(recurrences), validate({ query: schemas.monthQuerySchema }), asyncHandler(ops.getMonthBills));
recurrenceRoutes.post('/', can(recurrences), validate({ body: schemas.createRecurrenceSchema }), asyncHandler(ops.createRecurrence));
recurrenceRoutes.post('/installments/:id/pay', can(recurrences, 'pagar'),
  validate({ ...byId, body: schemas.payRecurrenceSchema }), asyncHandler(ops.payRecurrenceInstallment));
recurrenceRoutes.delete('/installments/:id/pay', can(recurrences, 'pagar'), validate(byId), asyncHandler(ops.undoRecurrencePayment));
recurrenceRoutes.get('/:id', can(recurrences), validate(byId), asyncHandler(ops.getRecurrence));
recurrenceRoutes.put('/:id', can(recurrences), validate({ ...byId, body: schemas.updateRecurrenceSchema }), asyncHandler(ops.updateRecurrence));
recurrenceRoutes.post('/:id/adjust', can(recurrences, 'editar'),
  validate({ ...byId, body: schemas.adjustRecurrenceSchema }), asyncHandler(ops.adjustRecurrence));
recurrenceRoutes.post('/:id/end', can(recurrences, 'encerrar'),
  validate({ ...byId, body: schemas.endRecurrenceSchema }), asyncHandler(ops.endRecurrence));
recurrenceRoutes.delete('/:id', can(recurrences), validate(byId), asyncHandler(ops.deleteRecurrence));

// /api/revenues
export const revenueRoutes = scoped();
const revenues = 'financeiro.receitas';
revenueRoutes.get('/', can(revenues), validate({ query: schemas.listRevenuesQuerySchema }), asyncHandler(ops.listRevenues));
revenueRoutes.get('/consolidated', can(revenues), validate({ query: schemas.requiredPeriodQuerySchema }), asyncHandler(ops.getConsolidatedRevenues));
revenueRoutes.post('/', can(revenues), validate({ body: schemas.createRevenueSchema }), asyncHandler(ops.createRevenue));
revenueRoutes.post('/installments/:id/receive', can(revenues, 'editar'),
  validate({ ...byId, body: schemas.receiveInstallmentSchema }), asyncHandler(ops.receiveRevenueInstallment));
revenueRoutes.delete('/installments/:id/receive', can(revenues, 'editar'), validate(byId), asyncHandler(ops.undoRevenueReceipt));
revenueRoutes.get('/:id', can(revenues), validate(byId), asyncHandler(ops.getRevenue));
revenueRoutes.put('/:id', can(revenues), validate({ ...byId, body: schemas.updateRevenueSchema }), asyncHandler(ops.updateRevenue));
revenueRoutes.post('/:id/cancel', can(revenues, 'cancelar'), validate(byId), asyncHandler(ops.cancelRevenue));
revenueRoutes.delete('/:id', can(revenues), validate(byId), asyncHandler(ops.deleteRevenue));
