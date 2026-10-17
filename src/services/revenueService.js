import knex from '../database/connection.js';
import { generateId } from '../utils/helpers.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import { MOVEMENT_TYPES, createMovement, deleteMovements, ensureAccount } from './movementService.js';
import { bool, ensureCategory, isoDate, money, requireEffective, shiftMonths, splitAmount, today } from './operationsCommon.js';

/**
 * Revenues (E6, RF-RT). Only cash and boleto (and "other") revenues are typed
 * here; card sales and bank entries already are revenues and appear in the
 * consolidated view without being entered twice (RN-02).
 */

export const INSTALLMENT_SOURCE = 'revenue_installment';
export const REVENUE_KINDS = ['cash', 'boleto', 'other'];

const formatInstallment = (row, now, cancelled) => {
  const received = bool(row.received);
  const dueDate = isoDate(row.due_date);
  let status = 'em_aberto';
  if (cancelled) status = 'cancelado';
  else if (received) status = 'recebido';
  else if (dueDate < now) status = 'vencido';
  return {
    id: row.id,
    revenueId: row.revenue_id,
    number: row.number,
    dueDate,
    amount: money(row.amount),
    received,
    receivedAmount: row.received_amount === null || row.received_amount === undefined ? null : money(row.received_amount),
    receivedDate: isoDate(row.received_date),
    accountId: row.account_id,
    status,
  };
};

const formatRevenue = (row, installments) => {
  const now = today();
  const cancelled = row.status === 'cancelled';
  const items = installments.map((item) => formatInstallment(item, now, cancelled));
  const received = money(items.filter((item) => item.received).reduce((sum, item) => sum + item.receivedAmount, 0));
  const receivable = cancelled ? 0 : money(items.filter((item) => !item.received).reduce((sum, item) => sum + item.amount, 0));
  let status = 'em_aberto';
  if (cancelled) status = 'cancelado';
  else if (receivable === 0) status = 'recebido';
  else if (items.some((item) => item.status === 'vencido')) status = 'vencido';
  else if (received > 0) status = 'parcial';
  return {
    id: row.id,
    kind: row.kind,
    description: row.description,
    customer: row.customer,
    document: row.document,
    categoryId: row.category_id,
    categoryName: row.category_name || null,
    grossAmount: money(row.gross_amount),
    discount: money(row.discount),
    fee: money(row.fee),
    netAmount: money(Number(row.gross_amount) - Number(row.discount) - Number(row.fee)),
    issueDate: isoDate(row.issue_date),
    status,
    received,
    receivable,
    installments: items,
  };
};

const revenueQuery = (userId) => knex('revenues as r')
  .leftJoin('categories as c', 'c.id', 'r.category_id')
  .where('r.user_id', userId)
  .select('r.*', 'c.name as category_name');

export async function getRevenue(userId, revenueId) {
  const row = await revenueQuery(userId).where('r.id', revenueId).first();
  if (!row) throw new NotFoundError('Revenue not found', 'REVENUE_NOT_FOUND');
  const installments = await knex('revenue_installments').where('revenue_id', revenueId).orderBy('number');
  return formatRevenue(row, installments);
}

async function receiveRow(trx, userId, revenue, installment, { date, amount, accountId }) {
  const value = money(amount ?? installment.amount);
  requireEffective({ date, amount: value });
  // Without an account the revenue is recorded without touching any balance (UC-08).
  if (accountId) {
    await createMovement(trx, userId, {
      accountId,
      amount: value,
      date,
      description: revenue.description,
      type: MOVEMENT_TYPES.income,
      categoryId: revenue.category_id || null,
      sourceType: INSTALLMENT_SOURCE,
      sourceId: installment.id,
    });
  }
  await trx('revenue_installments').where('id', installment.id).update({
    received: true, received_amount: value, received_date: date, account_id: accountId || null,
  });
}

const buildInstallments = (revenueId, data, net) => {
  const count = data.installmentCount || 1;
  const firstDue = data.firstDueDate || data.issueDate;
  return splitAmount(net, count).map((amount, index) => ({
    id: generateId(),
    revenue_id: revenueId,
    number: index + 1,
    due_date: shiftMonths(firstDue, index),
    amount,
    received: false,
  }));
};

const netOf = (data) => {
  const net = money(Number(data.grossAmount) - Number(data.discount || 0) - Number(data.fee || 0));
  if (net <= 0) throw new BadRequestError('Discounts and fees cannot exceed the gross amount', 'NET_NOT_POSITIVE');
  return net;
};

/** UC-08. `receivedNow` records a revenue received at once (cash, or a paid boleto). */
export async function createRevenue(userId, data) {
  await ensureCategory(knex, userId, data.categoryId);
  if (data.receivedNow?.accountId) await ensureAccount(knex, userId, data.receivedNow.accountId);
  const net = netOf(data);
  const id = generateId();
  await knex.transaction(async (trx) => {
    await trx('revenues').insert({
      id,
      user_id: userId,
      kind: data.kind,
      description: data.description,
      customer: data.customer || null,
      document: data.document || null,
      category_id: data.categoryId || null,
      gross_amount: money(data.grossAmount),
      discount: money(data.discount),
      fee: money(data.fee),
      issue_date: data.issueDate,
      status: 'active',
    });
    const installments = buildInstallments(id, data, net);
    await trx('revenue_installments').insert(installments);
    if (data.receivedNow) {
      const revenue = await trx('revenues').where('id', id).first();
      for (const installment of installments) {
        await receiveRow(trx, userId, revenue, installment, {
          date: data.receivedNow.date || data.issueDate,
          accountId: data.receivedNow.accountId,
        });
      }
    }
  });
  return getRevenue(userId, id);
}

export async function updateRevenue(userId, revenueId, data) {
  const current = await getRevenue(userId, revenueId);
  if (current.status === 'cancelado') throw new BadRequestError('Cancelled revenues cannot be changed', 'REVENUE_CANCELLED');
  if (data.categoryId) await ensureCategory(knex, userId, data.categoryId);
  const valueFields = ['grossAmount', 'discount', 'fee', 'issueDate', 'installmentCount', 'firstDueDate'];
  const changesValues = valueFields.some((field) => data[field] !== undefined);
  if (changesValues && current.installments.some((item) => item.received)) {
    throw new BadRequestError('Undo the received installments before changing the values', 'REVENUE_HAS_RECEIPTS');
  }
  const merged = { ...current, ...data };
  await knex.transaction(async (trx) => {
    const updates = {
      kind: merged.kind,
      description: merged.description,
      customer: merged.customer ?? null,
      document: merged.document ?? null,
      category_id: merged.categoryId ?? null,
      updated_at: new Date(),
    };
    if (changesValues) {
      Object.assign(updates, {
        gross_amount: money(merged.grossAmount), discount: money(merged.discount), fee: money(merged.fee), issue_date: merged.issueDate,
      });
      await trx('revenue_installments').where('revenue_id', revenueId).del();
      await trx('revenue_installments').insert(buildInstallments(revenueId, {
        installmentCount: data.installmentCount || current.installments.length,
        firstDueDate: data.firstDueDate || current.installments[0]?.dueDate,
        issueDate: merged.issueDate,
      }, netOf(merged)));
    }
    await trx('revenues').where('id', revenueId).update(updates);
  });
  return getRevenue(userId, revenueId);
}

async function findInstallment(userId, installmentId) {
  const row = await knex('revenue_installments as i')
    .join('revenues as r', 'r.id', 'i.revenue_id')
    .where({ 'i.id': installmentId, 'r.user_id': userId })
    .select('i.*', 'r.status as revenue_status')
    .first();
  if (!row) throw new NotFoundError('Installment not found', 'INSTALLMENT_NOT_FOUND');
  if (row.revenue_status === 'cancelled') throw new BadRequestError('Cancelled revenues cannot be changed', 'REVENUE_CANCELLED');
  return row;
}

export async function receiveInstallment(userId, installmentId, data) {
  const installment = await findInstallment(userId, installmentId);
  if (bool(installment.received)) throw new BadRequestError('This installment is already received', 'ALREADY_RECEIVED');
  if (data.accountId) await ensureAccount(knex, userId, data.accountId);
  const revenue = await knex('revenues').where('id', installment.revenue_id).first();
  await knex.transaction((trx) => receiveRow(trx, userId, revenue, installment, data));
  return getRevenue(userId, installment.revenue_id);
}

export async function undoReceipt(userId, installmentId) {
  const installment = await findInstallment(userId, installmentId);
  if (!bool(installment.received)) throw new BadRequestError('This installment is not received', 'NOT_RECEIVED');
  await knex.transaction(async (trx) => {
    await deleteMovements(trx, userId, INSTALLMENT_SOURCE, installmentId);
    await trx('revenue_installments').where('id', installmentId).update({
      received: false, received_amount: null, received_date: null, account_id: null,
    });
  });
  return getRevenue(userId, installment.revenue_id);
}

/** RN-12: cancelling keeps the record and its history but reverses its movements. */
export async function cancelRevenue(userId, revenueId) {
  const revenue = await getRevenue(userId, revenueId);
  if (revenue.status === 'cancelado') return revenue;
  await knex.transaction(async (trx) => {
    for (const installment of revenue.installments) {
      await deleteMovements(trx, userId, INSTALLMENT_SOURCE, installment.id);
    }
    await trx('revenues').where('id', revenueId).update({ status: 'cancelled', updated_at: new Date() });
  });
  return getRevenue(userId, revenueId);
}

export async function deleteRevenue(userId, revenueId) {
  const revenue = await getRevenue(userId, revenueId);
  await knex.transaction(async (trx) => {
    for (const installment of revenue.installments) {
      await deleteMovements(trx, userId, INSTALLMENT_SOURCE, installment.id);
    }
    await trx('revenue_installments').where('revenue_id', revenueId).del();
    await trx('revenues').where('id', revenueId).del();
  });
  return revenue;
}

export async function listRevenues(userId, { from, to, kind, status } = {}) {
  const rows = await revenueQuery(userId)
    .modify((query) => {
      if (from) query.where('r.issue_date', '>=', from);
      if (to) query.where('r.issue_date', '<=', to);
      if (kind) query.where('r.kind', kind);
    })
    .orderBy('r.issue_date', 'desc');
  const installments = rows.length
    ? await knex('revenue_installments').whereIn('revenue_id', rows.map((row) => row.id)).orderBy('number')
    : [];
  const byRevenue = new Map();
  for (const item of installments) {
    const list = byRevenue.get(item.revenue_id) || [];
    list.push(item);
    byRevenue.set(item.revenue_id, list);
  }
  const revenues = rows.map((row) => formatRevenue(row, byRevenue.get(row.id) || []));
  return status ? revenues.filter((revenue) => revenue.status === status) : revenues;
}

/**
 * RF-RT-01: every revenue of the period in one list, derived from its source
 * record. Card sales count at gross on the sale date; transfers never count.
 */
export async function consolidated(userId, { from, to }) {
  const [revenues, sales, entries] = await Promise.all([
    revenueQuery(userId)
      .whereNot('r.status', 'cancelled')
      .where('r.issue_date', '>=', from).where('r.issue_date', '<=', to),
    knex('card_sales as s').leftJoin('categories as c', 'c.id', 's.category_id')
      .where('s.user_id', userId)
      .where('s.sale_date', '>=', from).where('s.sale_date', '<=', to)
      .select('s.*', 'c.name as category_name'),
    knex('bank_entries as e').leftJoin('categories as c', 'c.id', 'e.category_id')
      .where('e.user_id', userId).whereNull('e.origin_account_id')
      .where('e.date', '>=', from).where('e.date', '<=', to)
      .select('e.*', 'c.name as category_name'),
  ]);

  const items = [
    ...revenues.map((row) => ({
      source: row.kind === 'boleto' ? 'boleto' : (row.kind === 'cash' ? 'dinheiro' : 'outras'),
      sourceType: 'revenue', sourceId: row.id, date: isoDate(row.issue_date), description: row.description,
      customer: row.customer, categoryId: row.category_id, categoryName: row.category_name || null,
      gross: money(row.gross_amount), deductions: money(Number(row.discount) + Number(row.fee)),
    })),
    ...sales.map((row) => ({
      source: 'cartao', sourceType: 'card_sale', sourceId: row.id, date: isoDate(row.sale_date),
      description: [row.brand, row.acquirer].filter(Boolean).join(' · ') || 'Venda no cartão',
      customer: row.customer, categoryId: row.category_id, categoryName: row.category_name || null,
      gross: money(row.gross_amount), deductions: money(Number(row.fee_amount) + Number(row.discount)),
    })),
    ...entries.map((row) => ({
      source: 'entrada', sourceType: 'bank_entry', sourceId: row.id, date: isoDate(row.date), description: row.description,
      customer: row.payer, categoryId: row.category_id, categoryName: row.category_name || null,
      gross: money(row.amount), deductions: 0,
    })),
  ].map((item) => ({ ...item, net: money(item.gross - item.deductions) }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const group = (key) => {
    const map = new Map();
    for (const item of items) {
      const id = item[key] || 'none';
      const entry = map.get(id) || { key: id, label: key === 'categoryId' ? (item.categoryName || null) : id, gross: 0, net: 0, count: 0 };
      entry.gross = money(entry.gross + item.gross);
      entry.net = money(entry.net + item.net);
      entry.count += 1;
      map.set(id, entry);
    }
    return [...map.values()].sort((a, b) => b.gross - a.gross);
  };

  return {
    from,
    to,
    items,
    totals: {
      gross: money(items.reduce((sum, item) => sum + item.gross, 0)),
      deductions: money(items.reduce((sum, item) => sum + item.deductions, 0)),
      net: money(items.reduce((sum, item) => sum + item.net, 0)),
    },
    bySource: group('source'),
    byCategory: group('categoryId'),
  };
}

export default {
  listRevenues, getRevenue, createRevenue, updateRevenue, receiveInstallment, undoReceipt, cancelRevenue,
  deleteRevenue, consolidated, INSTALLMENT_SOURCE, REVENUE_KINDS,
};
