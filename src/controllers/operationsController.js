import { recordChange } from '../services/auditService.js';
import invoiceService from '../services/invoiceService.js';
import cardSaleService from '../services/cardSaleService.js';
import bankEntryService from '../services/bankEntryService.js';
import recurrenceService from '../services/recurrenceService.js';
import revenueService from '../services/revenueService.js';

/**
 * PAINEL R2 operations. Each mutation records its own audit event with the
 * whole record (installments included) before and after, so the generic
 * route audit is skipped.
 */
const audit = async (req, res, { entity, entityId, action, before = null, after = null }) => {
  res.locals.auditRecorded = true;
  await recordChange({
    workspaceId: req.workspace?.id,
    actorUserId: req.actorUser?.id,
    entity,
    entityId,
    action,
    before,
    after,
  });
};

const send = (res, data, status = 200) => res.status(status).json({ success: true, data });

// Faturas (E2)
export const listInvoices = async (req, res) => {
  send(res, { invoices: await invoiceService.listInvoices(req.user.id, req.query) });
};

export const getInvoice = async (req, res) => {
  send(res, { invoice: await invoiceService.getInvoice(req.user.id, req.params.id) });
};

export const getCardsSummary = async (req, res) => {
  send(res, await invoiceService.getCardsSummary(req.user.id));
};

export const payInvoice = async (req, res) => {
  const before = await invoiceService.getInvoice(req.user.id, req.params.id);
  const result = await invoiceService.payInvoice(req.user.id, req.params.id, req.body, req.actorUser?.id);
  await audit(req, res, { entity: 'fatura', entityId: req.params.id, action: 'pagar', before, after: result.invoice });
  send(res, { id: result.id, invoice: result.invoice }, 201);
};

export const deleteInvoicePayment = async (req, res) => {
  const result = await invoiceService.deletePayment(req.user.id, req.params.id);
  await audit(req, res, { entity: 'fatura', entityId: result.invoice.id, action: 'excluir_pagamento', after: result.invoice });
  send(res, { invoice: result.invoice });
};

// Vendas no cartão (E3)
export const listCardSales = async (req, res) => {
  send(res, await cardSaleService.listSales(req.user.id, req.query));
};

export const getCardSale = async (req, res) => {
  send(res, { sale: await cardSaleService.getSale(req.user.id, req.params.id) });
};

export const createCardSale = async (req, res) => {
  const sale = await cardSaleService.createSale(req.user.id, req.body);
  await audit(req, res, { entity: 'venda_cartao', entityId: sale.id, action: 'criar', after: sale });
  send(res, { sale }, 201);
};

export const updateCardSale = async (req, res) => {
  const before = await cardSaleService.getSale(req.user.id, req.params.id);
  const sale = await cardSaleService.updateSale(req.user.id, req.params.id, req.body);
  await audit(req, res, { entity: 'venda_cartao', entityId: sale.id, action: 'editar', before, after: sale });
  send(res, { sale });
};

export const deleteCardSale = async (req, res) => {
  const before = await cardSaleService.deleteSale(req.user.id, req.params.id);
  await audit(req, res, { entity: 'venda_cartao', entityId: before.id, action: 'excluir', before });
  send(res, { id: before.id });
};

export const creditCardSaleInstallment = async (req, res) => {
  const sale = await cardSaleService.creditInstallment(req.user.id, req.params.id, req.body);
  await audit(req, res, { entity: 'venda_cartao', entityId: sale.id, action: 'creditar', after: sale });
  send(res, { sale });
};

export const undoCardSaleCredit = async (req, res) => {
  const sale = await cardSaleService.undoCredit(req.user.id, req.params.id);
  await audit(req, res, { entity: 'venda_cartao', entityId: sale.id, action: 'desfazer_credito', after: sale });
  send(res, { sale });
};

// Entradas bancárias (E4)
export const listBankEntries = async (req, res) => {
  send(res, await bankEntryService.listEntries(req.user.id, req.query));
};

export const createBankEntry = async (req, res) => {
  const entry = await bankEntryService.createEntry(req.user.id, req.body);
  await audit(req, res, { entity: 'entrada', entityId: entry.id, action: 'criar', after: entry });
  send(res, { entry }, 201);
};

export const updateBankEntry = async (req, res) => {
  const before = await bankEntryService.getEntry(req.user.id, req.params.id);
  const entry = await bankEntryService.updateEntry(req.user.id, req.params.id, req.body);
  await audit(req, res, { entity: 'entrada', entityId: entry.id, action: 'editar', before, after: entry });
  send(res, { entry });
};

export const deleteBankEntry = async (req, res) => {
  const before = await bankEntryService.deleteEntry(req.user.id, req.params.id);
  await audit(req, res, { entity: 'entrada', entityId: before.id, action: 'excluir', before });
  send(res, { id: before.id });
};

// Recorrências (E5)
export const listRecurrences = async (req, res) => {
  send(res, { recurrences: await recurrenceService.listRecurrences(req.user.id, req.query) });
};

export const getRecurrence = async (req, res) => {
  send(res, { recurrence: await recurrenceService.getRecurrence(req.user.id, req.params.id) });
};

export const getMonthBills = async (req, res) => {
  send(res, await recurrenceService.monthBills(req.user.id, req.query.month));
};

export const createRecurrence = async (req, res) => {
  const recurrence = await recurrenceService.createRecurrence(req.user.id, req.body);
  await audit(req, res, { entity: 'recorrencia', entityId: recurrence.id, action: 'criar', after: recurrence });
  send(res, { recurrence }, 201);
};

const recurrenceChange = (action, run) => async (req, res) => {
  const before = await recurrenceService.getRecurrence(req.user.id, req.params.id);
  const recurrence = await run(req);
  await audit(req, res, { entity: 'recorrencia', entityId: recurrence.id, action, before, after: recurrence });
  send(res, { recurrence });
};

export const updateRecurrence = recurrenceChange('editar', (req) => recurrenceService.updateRecurrence(req.user.id, req.params.id, req.body));
export const adjustRecurrence = recurrenceChange('reajustar', (req) => recurrenceService.adjustRecurrence(req.user.id, req.params.id, req.body));
export const endRecurrence = recurrenceChange('encerrar', (req) => recurrenceService.endRecurrence(req.user.id, req.params.id, req.body));

export const deleteRecurrence = async (req, res) => {
  const before = await recurrenceService.deleteRecurrence(req.user.id, req.params.id);
  await audit(req, res, { entity: 'recorrencia', entityId: before.id, action: 'excluir', before });
  send(res, { id: before.id });
};

export const payRecurrenceInstallment = async (req, res) => {
  const recurrence = await recurrenceService.payInstallment(req.user.id, req.params.id, req.body);
  await audit(req, res, { entity: 'recorrencia', entityId: recurrence.id, action: 'pagar', after: recurrence });
  send(res, { recurrence });
};

export const undoRecurrencePayment = async (req, res) => {
  const recurrence = await recurrenceService.undoPayment(req.user.id, req.params.id);
  await audit(req, res, { entity: 'recorrencia', entityId: recurrence.id, action: 'desfazer_pagamento', after: recurrence });
  send(res, { recurrence });
};

// Receitas (E6)
export const listRevenues = async (req, res) => {
  send(res, { revenues: await revenueService.listRevenues(req.user.id, req.query) });
};

export const getConsolidatedRevenues = async (req, res) => {
  send(res, await revenueService.consolidated(req.user.id, req.query));
};

export const getRevenue = async (req, res) => {
  send(res, { revenue: await revenueService.getRevenue(req.user.id, req.params.id) });
};

export const createRevenue = async (req, res) => {
  const revenue = await revenueService.createRevenue(req.user.id, req.body);
  await audit(req, res, { entity: 'receita', entityId: revenue.id, action: 'criar', after: revenue });
  send(res, { revenue }, 201);
};

export const updateRevenue = async (req, res) => {
  const before = await revenueService.getRevenue(req.user.id, req.params.id);
  const revenue = await revenueService.updateRevenue(req.user.id, req.params.id, req.body);
  await audit(req, res, { entity: 'receita', entityId: revenue.id, action: 'editar', before, after: revenue });
  send(res, { revenue });
};

export const cancelRevenue = async (req, res) => {
  const before = await revenueService.getRevenue(req.user.id, req.params.id);
  const revenue = await revenueService.cancelRevenue(req.user.id, req.params.id);
  await audit(req, res, { entity: 'receita', entityId: revenue.id, action: 'cancelar', before, after: revenue });
  send(res, { revenue });
};

export const deleteRevenue = async (req, res) => {
  const before = await revenueService.deleteRevenue(req.user.id, req.params.id);
  await audit(req, res, { entity: 'receita', entityId: before.id, action: 'excluir', before });
  send(res, { id: before.id });
};

export const receiveRevenueInstallment = async (req, res) => {
  const revenue = await revenueService.receiveInstallment(req.user.id, req.params.id, req.body);
  await audit(req, res, { entity: 'receita', entityId: revenue.id, action: 'receber', after: revenue });
  send(res, { revenue });
};

export const undoRevenueReceipt = async (req, res) => {
  const revenue = await revenueService.undoReceipt(req.user.id, req.params.id);
  await audit(req, res, { entity: 'receita', entityId: revenue.id, action: 'desfazer_recebimento', after: revenue });
  send(res, { revenue });
};
