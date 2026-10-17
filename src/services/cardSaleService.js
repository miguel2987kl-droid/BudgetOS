import knex from '../database/connection.js';
import { generateId } from '../utils/helpers.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import { MOVEMENT_TYPES, createMovement, deleteMovements, ensureAccount } from './movementService.js';
import { bool, ensureCategory, isoDate, money, requireEffective, shiftDays, shiftMonths, splitAmount, today } from './operationsCommon.js';

/**
 * Card sales (E3, RF-VC). The sale is the revenue, at its gross value on the
 * sale date; each installment is a receivable at the net value, and crediting
 * it only settles the receivable (RN-06, RN-07, RN-08).
 */

export const INSTALLMENT_SOURCE = 'card_sale_installment';

const computeValues = ({ grossAmount, feeRate = 0, discount = 0 }) => {
  const gross = money(grossAmount);
  const feeAmount = money((gross * Number(feeRate || 0)) / 100);
  const discountValue = money(discount);
  const net = money(gross - feeAmount - discountValue);
  if (net <= 0) throw new BadRequestError('Fees and discounts cannot exceed the gross amount', 'NET_NOT_POSITIVE');
  return { gross, feeAmount, discount: discountValue, net };
};

/** First credit after `creditDays`, then one installment per month. */
const buildInstallments = (saleId, { saleDate, installmentCount, creditDays, net, accountId }) => {
  const firstDate = shiftDays(saleDate, creditDays);
  return splitAmount(net, installmentCount).map((amount, index) => ({
    id: generateId(),
    sale_id: saleId,
    number: index + 1,
    expected_date: shiftMonths(firstDate, index),
    amount,
    credited: false,
    account_id: accountId,
  }));
};

const formatInstallment = (row, now) => ({
  id: row.id,
  number: row.number,
  expectedDate: isoDate(row.expected_date),
  amount: money(row.amount),
  credited: bool(row.credited),
  creditedDate: isoDate(row.credited_date),
  creditedAmount: row.credited_amount === null || row.credited_amount === undefined ? null : money(row.credited_amount),
  accountId: row.account_id,
  status: bool(row.credited) ? 'creditado' : (isoDate(row.expected_date) < now ? 'atrasado' : 'previsto'),
});

const formatSale = (sale, installments) => {
  const now = today();
  const items = installments.map((row) => formatInstallment(row, now));
  const received = money(items.filter((item) => item.credited).reduce((sum, item) => sum + item.creditedAmount, 0));
  const receivable = money(items.filter((item) => !item.credited).reduce((sum, item) => sum + item.amount, 0));
  return {
    id: sale.id,
    customer: sale.customer,
    kind: sale.kind,
    brand: sale.brand,
    acquirer: sale.acquirer,
    grossAmount: money(sale.gross_amount),
    feeRate: Number(sale.fee_rate || 0),
    feeAmount: money(sale.fee_amount),
    discount: money(sale.discount),
    netAmount: money(Number(sale.gross_amount) - Number(sale.fee_amount) - Number(sale.discount)),
    saleDate: isoDate(sale.sale_date),
    installmentCount: sale.installment_count,
    creditDays: sale.credit_days,
    accountId: sale.account_id,
    accountName: sale.account_name || null,
    categoryId: sale.category_id,
    categoryName: sale.category_name || null,
    document: sale.document,
    notes: sale.notes,
    status: sale.status,
    received,
    receivable,
    installments: items,
  };
};

const saleQuery = (userId) => knex('card_sales as s')
  .leftJoin('accounts as a', 'a.id', 's.account_id')
  .leftJoin('categories as c', 'c.id', 's.category_id')
  .where('s.user_id', userId)
  .select('s.*', 'a.name as account_name', 'c.name as category_name');

export async function getSale(userId, saleId) {
  const sale = await saleQuery(userId).where('s.id', saleId).first();
  if (!sale) throw new NotFoundError('Card sale not found', 'CARD_SALE_NOT_FOUND');
  const installments = await knex('card_sale_installments').where('sale_id', saleId).orderBy('number');
  return formatSale(sale, installments);
}

async function creditInstallmentRow(trx, userId, sale, installment, { date, amount, accountId }) {
  const value = money(amount ?? installment.amount);
  requireEffective({ date, amount: value });
  const targetAccount = accountId || installment.account_id || sale.account_id;
  if (!targetAccount) throw new BadRequestError('Choose the account that received the credit', 'ACCOUNT_REQUIRED');
  await createMovement(trx, userId, {
    accountId: targetAccount,
    amount: value,
    date,
    description: `Crédito venda cartão ${sale.customer || sale.brand || ''} ${installment.number}/${sale.installment_count}`.replace(/\s+/g, ' ').trim(),
    type: MOVEMENT_TYPES.settlement,
    categoryId: null,
    sourceType: INSTALLMENT_SOURCE,
    sourceId: installment.id,
  });
  await trx('card_sale_installments').where('id', installment.id).update({
    credited: true,
    credited_date: date,
    credited_amount: value,
    account_id: targetAccount,
  });
}

/** UC-05. `creditNow` registers a sale already credited in full (debit or anticipation). */
export async function createSale(userId, data) {
  await ensureAccount(knex, userId, data.accountId);
  await ensureCategory(knex, userId, data.categoryId);
  const kind = data.kind || 'credit';
  const installmentCount = kind === 'debit' ? 1 : (data.installmentCount || 1);
  const creditDays = data.creditDays ?? (kind === 'debit' ? 1 : 30);
  const values = computeValues(data);
  const id = generateId();

  await knex.transaction(async (trx) => {
    await trx('card_sales').insert({
      id,
      user_id: userId,
      customer: data.customer || null,
      kind,
      brand: data.brand || null,
      acquirer: data.acquirer || null,
      gross_amount: values.gross,
      fee_rate: Number(data.feeRate || 0),
      fee_amount: values.feeAmount,
      discount: values.discount,
      sale_date: data.saleDate,
      installment_count: installmentCount,
      credit_days: creditDays,
      account_id: data.accountId,
      category_id: data.categoryId || null,
      document: data.document || null,
      notes: data.notes || null,
      status: 'active',
    });
    const installments = buildInstallments(id, { ...data, installmentCount, creditDays, net: values.net });
    await trx('card_sale_installments').insert(installments);

    if (data.creditNow) {
      const sale = await trx('card_sales').where('id', id).first();
      const date = data.creditDate || data.saleDate;
      for (const installment of installments) {
        await creditInstallmentRow(trx, userId, sale, installment, { date });
      }
    }
  });
  return getSale(userId, id);
}

/** Descriptive fields can always change; values only while nothing was credited. */
export async function updateSale(userId, saleId, data) {
  const current = await getSale(userId, saleId);
  const anyCredited = current.installments.some((item) => item.credited);
  const valueFields = ['grossAmount', 'feeRate', 'discount', 'saleDate', 'installmentCount', 'creditDays', 'kind', 'accountId'];
  const changesValues = valueFields.some((field) => data[field] !== undefined && data[field] !== current[field]);
  if (changesValues && anyCredited) {
    throw new BadRequestError('Undo the credited installments before changing the sale values', 'SALE_HAS_CREDITS');
  }
  if (data.accountId) await ensureAccount(knex, userId, data.accountId);
  if (data.categoryId) await ensureCategory(knex, userId, data.categoryId);

  const merged = { ...current, ...data };
  const kind = merged.kind;
  const installmentCount = kind === 'debit' ? 1 : merged.installmentCount;
  const values = computeValues(merged);

  await knex.transaction(async (trx) => {
    const updates = {
      customer: merged.customer ?? null,
      brand: merged.brand ?? null,
      acquirer: merged.acquirer ?? null,
      category_id: merged.categoryId ?? null,
      document: merged.document ?? null,
      notes: merged.notes ?? null,
      updated_at: new Date(),
    };
    if (changesValues) {
      Object.assign(updates, {
        kind,
        gross_amount: values.gross,
        fee_rate: Number(merged.feeRate || 0),
        fee_amount: values.feeAmount,
        discount: values.discount,
        sale_date: merged.saleDate,
        installment_count: installmentCount,
        credit_days: merged.creditDays,
        account_id: merged.accountId,
      });
      await trx('card_sale_installments').where('sale_id', saleId).del();
      await trx('card_sale_installments').insert(buildInstallments(saleId, {
        saleDate: merged.saleDate, installmentCount, creditDays: merged.creditDays, net: values.net, accountId: merged.accountId,
      }));
    }
    await trx('card_sales').where('id', saleId).update(updates);
  });
  return getSale(userId, saleId);
}

async function findInstallment(userId, installmentId) {
  const row = await knex('card_sale_installments as i')
    .join('card_sales as s', 's.id', 'i.sale_id')
    .where({ 'i.id': installmentId, 's.user_id': userId })
    .select('i.*')
    .first();
  if (!row) throw new NotFoundError('Installment not found', 'INSTALLMENT_NOT_FOUND');
  return row;
}

export async function creditInstallment(userId, installmentId, data) {
  const installment = await findInstallment(userId, installmentId);
  if (bool(installment.credited)) throw new BadRequestError('This installment is already credited', 'ALREADY_CREDITED');
  if (data.accountId) await ensureAccount(knex, userId, data.accountId);
  const sale = await knex('card_sales').where('id', installment.sale_id).first();
  await knex.transaction((trx) => creditInstallmentRow(trx, userId, sale, installment, data));
  return getSale(userId, installment.sale_id);
}

/** UC-05 A2: undo a credit, reversing its movement. */
export async function undoCredit(userId, installmentId) {
  const installment = await findInstallment(userId, installmentId);
  if (!bool(installment.credited)) throw new BadRequestError('This installment is not credited', 'NOT_CREDITED');
  await knex.transaction(async (trx) => {
    await deleteMovements(trx, userId, INSTALLMENT_SOURCE, installmentId);
    await trx('card_sale_installments').where('id', installmentId).update({
      credited: false, credited_date: null, credited_amount: null,
    });
  });
  return getSale(userId, installment.sale_id);
}

export async function deleteSale(userId, saleId) {
  const sale = await getSale(userId, saleId);
  await knex.transaction(async (trx) => {
    for (const installment of sale.installments) {
      await deleteMovements(trx, userId, INSTALLMENT_SOURCE, installment.id);
    }
    await trx('card_sale_installments').where('sale_id', saleId).del();
    await trx('card_sales').where('id', saleId).del();
  });
  return sale;
}

/** List with the indicators of RF-VC-05. */
export async function listSales(userId, { from, to, accountId, status } = {}) {
  const sales = await saleQuery(userId)
    .modify((query) => {
      if (from) query.where('s.sale_date', '>=', from);
      if (to) query.where('s.sale_date', '<=', to);
      if (accountId) query.where('s.account_id', accountId);
    })
    .orderBy('s.sale_date', 'desc');
  const installments = sales.length
    ? await knex('card_sale_installments').whereIn('sale_id', sales.map((sale) => sale.id)).orderBy('number')
    : [];
  const bySale = new Map();
  for (const row of installments) {
    const list = bySale.get(row.sale_id) || [];
    list.push(row);
    bySale.set(row.sale_id, list);
  }
  let items = sales.map((sale) => formatSale(sale, bySale.get(sale.id) || []));
  if (status === 'open') items = items.filter((sale) => sale.receivable > 0);
  if (status === 'settled') items = items.filter((sale) => sale.receivable === 0);

  const now = today();
  const soon = shiftDays(now, 7);
  const upcoming = items
    .flatMap((sale) => sale.installments.filter((item) => !item.credited).map((item) => ({ ...item, saleId: sale.id, customer: sale.customer, brand: sale.brand })))
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  const sum = (list, key) => money(list.reduce((total, item) => total + item[key], 0));
  return {
    sales: items,
    indicators: {
      gross: sum(items, 'grossAmount'),
      fees: sum(items, 'feeAmount'),
      discounts: sum(items, 'discount'),
      net: sum(items, 'netAmount'),
      received: sum(items, 'received'),
      receivable: sum(items, 'receivable'),
      overdue: sum(upcoming.filter((item) => item.expectedDate < now), 'amount'),
      nextSevenDays: sum(upcoming.filter((item) => item.expectedDate >= now && item.expectedDate <= soon), 'amount'),
    },
    upcoming: upcoming.slice(0, 20),
  };
}

export default { createSale, updateSale, getSale, listSales, creditInstallment, undoCredit, deleteSale, INSTALLMENT_SOURCE };
