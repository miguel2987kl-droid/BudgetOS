import knex from '../database/connection.js';
import { generateId } from '../utils/helpers.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import { createTransferMovements, deleteMovements, ensureAccount } from './movementService.js';
import { isoDate, money, today } from './operationsCommon.js';

/**
 * Credit card invoices (E2, RF-FT). An invoice is a deferred card cycle; its
 * total is purchases minus refunds. Paying it moves money from the paying
 * account to the card account and is never an expense (RN-04).
 */

export const PAYMENT_SOURCE = 'credit_card_payment';

const CYCLE_TOTAL = "COALESCE(-SUM(CASE WHEN t.type IN ('expense', 'income') AND t.status <> 'void' THEN t.amount ELSE 0 END), 0)";

const invoiceStatus = ({ total, paid, pending, dueDate, cycleEnd }, now) => {
  if (pending <= 0 && total > 0) return 'paga';
  if (pending > 0 && dueDate < now) return 'vencida';
  if (paid > 0) return 'parcial';
  if (cycleEnd < now) return 'fechada';
  return 'aberta';
};

async function loadInvoices(userId, { cardId, cycleId, competence } = {}) {
  const cycles = await knex('credit_card_cycles as ccc')
    .join('credit_cards as cc', 'cc.id', 'ccc.credit_card_id')
    .leftJoin('transactions as t', 't.credit_card_cycle_id', 'ccc.id')
    .where({ 'cc.user_id': userId, 'cc.is_active': true })
    .modify((query) => {
      if (cardId) query.where('cc.id', cardId);
      if (cycleId) query.where('ccc.id', cycleId);
    })
    .groupBy(
      'ccc.id', 'ccc.credit_card_id', 'ccc.cycle_start_date', 'ccc.cycle_end_date', 'ccc.debit_date', 'ccc.status',
      'cc.name', 'cc.account_id', 'cc.credit_limit', 'cc.color'
    )
    .select(
      'ccc.id', 'ccc.credit_card_id', 'ccc.cycle_start_date', 'ccc.cycle_end_date', 'ccc.debit_date', 'ccc.status',
      'cc.name as card_name', 'cc.account_id as card_account_id', 'cc.credit_limit', 'cc.color as card_color'
    )
    .select(knex.raw(`${CYCLE_TOTAL} as total`))
    .select(knex.raw('COUNT(t.id) as transaction_count'))
    .orderBy('ccc.debit_date', 'asc');

  if (cycles.length === 0) return [];

  const payments = await knex('credit_card_payments as p')
    .leftJoin('accounts as a', 'a.id', 'p.account_id')
    .where('p.user_id', userId)
    .whereIn('p.credit_card_cycle_id', cycles.map((cycle) => cycle.id))
    .select('p.*', 'a.name as account_name')
    .orderBy('p.date', 'asc');
  const paymentsByCycle = new Map();
  for (const payment of payments) {
    const list = paymentsByCycle.get(payment.credit_card_cycle_id) || [];
    list.push({
      id: payment.id,
      accountId: payment.account_id,
      accountName: payment.account_name || null,
      amount: money(payment.amount),
      date: isoDate(payment.date),
    });
    paymentsByCycle.set(payment.credit_card_cycle_id, list);
  }

  const now = today();
  const invoices = cycles.map((cycle) => {
    const total = money(cycle.total);
    const cyclePayments = paymentsByCycle.get(cycle.id) || [];
    // Cycles debited by the legacy automatic debit count as fully paid.
    const paid = cycle.status === 'debited'
      ? total
      : money(cyclePayments.reduce((sum, payment) => sum + payment.amount, 0));
    const pending = money(Math.max(total - paid, 0));
    const dueDate = isoDate(cycle.debit_date);
    const cycleEnd = isoDate(cycle.cycle_end_date);
    return {
      id: cycle.id,
      creditCardId: cycle.credit_card_id,
      cardName: cycle.card_name,
      cardColor: cycle.card_color,
      cardAccountId: cycle.card_account_id,
      // The invoice takes the month its cycle closes, which is also the
      // accounting date BudgetOS gives the purchases in it.
      competence: cycleEnd.slice(0, 7),
      cycleStartDate: isoDate(cycle.cycle_start_date),
      cycleEndDate: cycleEnd,
      dueDate,
      total,
      paid,
      pending,
      transactionCount: Number(cycle.transaction_count || 0),
      status: invoiceStatus({ total, paid, pending, dueDate, cycleEnd }, now),
      payments: cyclePayments,
    };
  });

  return competence ? invoices.filter((invoice) => invoice.competence === competence) : invoices;
}

export async function listInvoices(userId, filters = {}) {
  return loadInvoices(userId, filters);
}

export async function getInvoice(userId, cycleId) {
  const [invoice] = await loadInvoices(userId, { cycleId });
  if (!invoice) throw new NotFoundError('Invoice not found', 'INVOICE_NOT_FOUND');
  const transactions = await knex('transactions as t')
    .leftJoin('categories as c', 'c.id', 't.category_id')
    .where({ 't.credit_card_cycle_id': cycleId, 't.user_id': userId })
    .whereIn('t.type', ['expense', 'income'])
    .select('t.id', 't.amount', 't.description', 't.date', 't.purchase_date', 't.status', 't.category_id',
      'c.name as category_name', 't.installment_number', 't.installment_count')
    .orderBy('t.date', 'asc');
  invoice.transactions = transactions.map((tx) => ({
    id: tx.id,
    amount: money(tx.amount),
    description: tx.description,
    date: isoDate(tx.date),
    purchaseDate: isoDate(tx.purchase_date),
    status: tx.status,
    categoryId: tx.category_id,
    categoryName: tx.category_name,
    installmentNumber: tx.installment_number,
    installmentCount: tx.installment_count,
  }));
  return invoice;
}

/** UC-04: register a payment of up to the pending amount. */
export async function payInvoice(userId, cycleId, { accountId, amount, date }, actorId = null) {
  const invoice = await getInvoice(userId, cycleId);
  const value = money(amount);
  if (!(value > 0)) throw new BadRequestError('Payment amount must be positive', 'INVALID_AMOUNT');
  if (value > invoice.pending) {
    throw new BadRequestError('The payment is larger than the pending amount of the invoice', 'AMOUNT_EXCEEDS_PENDING');
  }
  await ensureAccount(knex, userId, accountId);

  const id = generateId();
  await knex.transaction(async (trx) => {
    await trx('credit_card_payments').insert({
      id,
      user_id: userId,
      credit_card_cycle_id: cycleId,
      account_id: accountId,
      amount: value,
      date,
      created_by: actorId,
    });
    // Paying from the card's own account moves nothing: the purchases already left it.
    if (accountId !== invoice.cardAccountId) {
      await createTransferMovements(trx, userId, {
        fromAccountId: accountId,
        toAccountId: invoice.cardAccountId,
        amount: value,
        date,
        description: `Pagamento fatura ${invoice.cardName} ${invoice.competence}`,
        sourceType: PAYMENT_SOURCE,
        sourceId: id,
      });
    }
  });
  return { id, invoice: await getInvoice(userId, cycleId) };
}

export async function deletePayment(userId, paymentId) {
  const payment = await knex('credit_card_payments').where({ id: paymentId, user_id: userId }).first();
  if (!payment) throw new NotFoundError('Payment not found', 'PAYMENT_NOT_FOUND');
  await knex.transaction(async (trx) => {
    await deleteMovements(trx, userId, PAYMENT_SOURCE, paymentId);
    await trx('credit_card_payments').where('id', paymentId).del();
  });
  return { id: paymentId, invoice: await getInvoice(userId, payment.credit_card_cycle_id) };
}

/** Resumo geral dos cartões (RF-CC-05, RF-CC-06): limit, used, available and future commitments. */
export async function getCardsSummary(userId) {
  const cards = await knex('credit_cards').where({ user_id: userId, is_active: true }).orderBy('name');
  const invoices = await loadInvoices(userId);
  const now = today();
  const rows = cards.map((card) => {
    const cardInvoices = invoices.filter((invoice) => invoice.creditCardId === card.id);
    const used = money(cardInvoices.reduce((sum, invoice) => sum + invoice.pending, 0));
    const limit = card.credit_limit === null || card.credit_limit === undefined ? null : money(card.credit_limit);
    const current = cardInvoices.find((invoice) => invoice.cycleStartDate <= now && invoice.cycleEndDate >= now) || null;
    const future = cardInvoices.filter((invoice) => invoice.cycleStartDate > now);
    return {
      id: card.id,
      name: card.name,
      color: card.color,
      limit,
      used,
      available: limit === null ? null : money(limit - used),
      currentInvoice: current ? { id: current.id, competence: current.competence, total: current.total, dueDate: current.dueDate, status: current.status } : null,
      overdue: money(cardInvoices.filter((invoice) => invoice.status === 'vencida').reduce((sum, invoice) => sum + invoice.pending, 0)),
      futureCommitments: future.map((invoice) => ({ competence: invoice.competence, total: invoice.total })),
      futureTotal: money(future.reduce((sum, invoice) => sum + invoice.total, 0)),
    };
  });
  return {
    cards: rows,
    totals: {
      limit: money(rows.reduce((sum, row) => sum + (row.limit || 0), 0)),
      used: money(rows.reduce((sum, row) => sum + row.used, 0)),
      overdue: money(rows.reduce((sum, row) => sum + row.overdue, 0)),
      futureTotal: money(rows.reduce((sum, row) => sum + row.futureTotal, 0)),
    },
  };
}

export default { listInvoices, getInvoice, payInvoice, deletePayment, getCardsSummary, PAYMENT_SOURCE };
