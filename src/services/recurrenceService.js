import knex from '../database/connection.js';
import { generateId } from '../utils/helpers.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import { MOVEMENT_TYPES, createMovement, deleteMovements, ensureAccount } from './movementService.js';
import { bool, ensureCategory, isoDate, money, requireEffective, shiftMonths, today } from './operationsCommon.js';

/**
 * Recurrences (E5, RF-RC): fixed or open-ended series of monthly bills.
 * Paying with an account creates an expense movement; paying "outside the
 * accounts" changes no balance (RN-10); installments paid before the system
 * are kept for history only (RN-11).
 */

export const INSTALLMENT_SOURCE = 'recurrence_installment';

/** Open-ended recurrences keep this many months of installments ahead. */
const OPEN_ENDED_MONTHS_AHEAD = 12;

const installmentRow = (recurrenceId, number, recurrence, paidBeforeSystem = false) => ({
  id: generateId(),
  recurrence_id: recurrenceId,
  number,
  due_date: shiftMonths(recurrence.firstDueDate, number - 1),
  amount: money(recurrence.amount),
  paid: paidBeforeSystem,
  paid_amount: paidBeforeSystem ? money(recurrence.amount) : null,
  paid_date: null,
  outside_accounts: false,
  paid_before_system: paidBeforeSystem,
});

const formatInstallment = (row, now) => {
  const paid = bool(row.paid);
  const dueDate = isoDate(row.due_date);
  return {
    id: row.id,
    recurrenceId: row.recurrence_id,
    number: row.number,
    dueDate,
    amount: money(row.amount),
    paid,
    paidAmount: row.paid_amount === null || row.paid_amount === undefined ? null : money(row.paid_amount),
    paidDate: isoDate(row.paid_date),
    accountId: row.account_id,
    outsideAccounts: bool(row.outside_accounts),
    paidBeforeSystem: bool(row.paid_before_system),
    status: paid ? 'pago' : (dueDate < now ? 'vencido' : 'em_aberto'),
  };
};

const formatRecurrence = (row, installments) => {
  const now = today();
  const items = installments.map((item) => formatInstallment(item, now));
  const open = items.filter((item) => !item.paid);
  const total = row.total_installments === null || row.total_installments === undefined ? null : Number(row.total_installments);
  return {
    id: row.id,
    name: row.name,
    creditor: row.creditor,
    categoryId: row.category_id,
    categoryName: row.category_name || null,
    method: row.method,
    amount: money(row.amount),
    firstDueDate: isoDate(row.first_due_date),
    totalInstallments: total,
    openEnded: total === null,
    defaultAccountId: row.default_account_id,
    endedAt: isoDate(row.ended_at),
    notes: row.notes,
    paidCount: items.filter((item) => item.paid).length,
    installmentCount: items.length,
    // Saldo devedor: what is still to be paid on a series with an end.
    remainingBalance: total === null ? null : money(open.reduce((sum, item) => sum + item.amount, 0)),
    nextDue: open[0] || null,
    installments: items,
  };
};

const recurrenceQuery = (userId) => knex('recurrences as r')
  .leftJoin('categories as c', 'c.id', 'r.category_id')
  .where('r.user_id', userId)
  .select('r.*', 'c.name as category_name');

/** Keep open-ended, active recurrences generated up to a year ahead. */
async function extendOpenEnded(userId) {
  const horizon = shiftMonths(today(), OPEN_ENDED_MONTHS_AHEAD);
  const recurrences = await knex('recurrences').where({ user_id: userId }).whereNull('total_installments').whereNull('ended_at');
  for (const recurrence of recurrences) {
    const last = await knex('recurrence_installments').where('recurrence_id', recurrence.id).max({ number: 'number' }).first();
    let number = Number(last?.number || 0);
    const rows = [];
    const base = { firstDueDate: isoDate(recurrence.first_due_date), amount: recurrence.amount };
    const lastRow = number
      ? await knex('recurrence_installments').where({ recurrence_id: recurrence.id, number }).first()
      : null;
    // New installments repeat the latest value, so a past adjustment carries on.
    if (lastRow) base.amount = lastRow.amount;
    while (shiftMonths(base.firstDueDate, number) <= horizon) {
      number += 1;
      rows.push(installmentRow(recurrence.id, number, base));
    }
    if (rows.length) await knex('recurrence_installments').insert(rows);
  }
}

export async function getRecurrence(userId, recurrenceId) {
  const row = await recurrenceQuery(userId).where('r.id', recurrenceId).first();
  if (!row) throw new NotFoundError('Recurrence not found', 'RECURRENCE_NOT_FOUND');
  const installments = await knex('recurrence_installments').where('recurrence_id', recurrenceId).orderBy('number');
  return formatRecurrence(row, installments);
}

export async function listRecurrences(userId, { status } = {}) {
  await extendOpenEnded(userId);
  const rows = await recurrenceQuery(userId)
    .modify((query) => {
      if (status === 'active') query.whereNull('r.ended_at');
      if (status === 'ended') query.whereNotNull('r.ended_at');
    })
    .orderBy('r.name');
  const installments = rows.length
    ? await knex('recurrence_installments').whereIn('recurrence_id', rows.map((row) => row.id)).orderBy('number')
    : [];
  const byRecurrence = new Map();
  for (const item of installments) {
    const list = byRecurrence.get(item.recurrence_id) || [];
    list.push(item);
    byRecurrence.set(item.recurrence_id, list);
  }
  return rows.map((row) => formatRecurrence(row, byRecurrence.get(row.id) || []));
}

/** UC-07 step 1: `paidBeforeSystem` marks the first N installments as paid outside history. */
export async function createRecurrence(userId, data) {
  await ensureCategory(knex, userId, data.categoryId);
  if (data.defaultAccountId) await ensureAccount(knex, userId, data.defaultAccountId);
  const total = data.totalInstallments || null;
  const paidBefore = data.paidBeforeSystem || 0;
  if (total && paidBefore > total) throw new BadRequestError('More paid installments than the series has', 'INVALID_PAID_BEFORE');

  const id = generateId();
  await knex.transaction(async (trx) => {
    await trx('recurrences').insert({
      id,
      user_id: userId,
      name: data.name,
      creditor: data.creditor || null,
      category_id: data.categoryId || null,
      method: data.method || null,
      amount: money(data.amount),
      first_due_date: data.firstDueDate,
      total_installments: total,
      default_account_id: data.defaultAccountId || null,
      notes: data.notes || null,
    });
    if (total) {
      const rows = Array.from({ length: total }, (_, index) => installmentRow(id, index + 1, data, index < paidBefore));
      for (let start = 0; start < rows.length; start += 100) {
        await trx('recurrence_installments').insert(rows.slice(start, start + 100));
      }
    } else if (paidBefore > 0) {
      await trx('recurrence_installments').insert(
        Array.from({ length: paidBefore }, (_, index) => installmentRow(id, index + 1, data, true))
      );
    }
  });
  if (!total) await extendOpenEnded(userId);
  return getRecurrence(userId, id);
}

export async function updateRecurrence(userId, recurrenceId, data) {
  await getRecurrence(userId, recurrenceId);
  if (data.categoryId) await ensureCategory(knex, userId, data.categoryId);
  if (data.defaultAccountId) await ensureAccount(knex, userId, data.defaultAccountId);
  const updates = { updated_at: new Date() };
  const fields = { name: 'name', creditor: 'creditor', categoryId: 'category_id', method: 'method', defaultAccountId: 'default_account_id', notes: 'notes' };
  for (const [key, column] of Object.entries(fields)) {
    if (data[key] !== undefined) updates[column] = data[key];
  }
  await knex('recurrences').where('id', recurrenceId).update(updates);
  return getRecurrence(userId, recurrenceId);
}

/** Reajuste: new value for open installments from a given number on. */
export async function adjustRecurrence(userId, recurrenceId, { amount, fromNumber }) {
  const recurrence = await getRecurrence(userId, recurrenceId);
  const value = money(amount);
  if (!(value > 0)) throw new BadRequestError('Amount must be positive', 'INVALID_AMOUNT');
  const start = fromNumber || recurrence.nextDue?.number;
  if (!start) throw new BadRequestError('There are no open installments to adjust', 'NOTHING_TO_ADJUST');
  await knex('recurrence_installments')
    .where('recurrence_id', recurrenceId)
    .where('paid', false)
    .where('number', '>=', start)
    .update({ amount: value });
  await knex('recurrences').where('id', recurrenceId).update({ amount: value, updated_at: new Date() });
  return getRecurrence(userId, recurrenceId);
}

/** Encerrar: open installments due after the end date are dropped. */
export async function endRecurrence(userId, recurrenceId, { endDate }) {
  await getRecurrence(userId, recurrenceId);
  const date = endDate || today();
  await knex.transaction(async (trx) => {
    await trx('recurrence_installments')
      .where('recurrence_id', recurrenceId)
      .where('paid', false)
      .where('due_date', '>', date)
      .del();
    await trx('recurrences').where('id', recurrenceId).update({ ended_at: date, updated_at: new Date() });
  });
  return getRecurrence(userId, recurrenceId);
}

export async function deleteRecurrence(userId, recurrenceId) {
  const recurrence = await getRecurrence(userId, recurrenceId);
  await knex.transaction(async (trx) => {
    for (const installment of recurrence.installments) {
      await deleteMovements(trx, userId, INSTALLMENT_SOURCE, installment.id);
    }
    await trx('recurrence_installments').where('recurrence_id', recurrenceId).del();
    await trx('recurrences').where('id', recurrenceId).del();
  });
  return recurrence;
}

async function findInstallment(userId, installmentId) {
  const row = await knex('recurrence_installments as i')
    .join('recurrences as r', 'r.id', 'i.recurrence_id')
    .where({ 'i.id': installmentId, 'r.user_id': userId })
    .select('i.*', 'r.name as recurrence_name', 'r.category_id as recurrence_category_id', 'r.total_installments')
    .first();
  if (!row) throw new NotFoundError('Installment not found', 'INSTALLMENT_NOT_FOUND');
  return row;
}

const recurringCategoryId = async (userId) => {
  const category = await knex('categories').where({ user_id: userId, name: 'Recorrências', type: 'expense' }).first();
  return category?.id || null;
};

/** UC-07 step 3: pay with an account, or outside the accounts. */
export async function payInstallment(userId, installmentId, { date, amount, accountId, outsideAccounts }) {
  const installment = await findInstallment(userId, installmentId);
  if (bool(installment.paid)) throw new BadRequestError('This installment is already paid', 'ALREADY_PAID');
  const value = money(amount ?? installment.amount);
  requireEffective({ date, amount: value });
  if (!outsideAccounts && !accountId) {
    throw new BadRequestError('Choose the account or mark the payment as outside the accounts', 'ACCOUNT_REQUIRED');
  }
  if (!outsideAccounts) await ensureAccount(knex, userId, accountId);
  const categoryId = installment.recurrence_category_id || await recurringCategoryId(userId);
  const label = installment.total_installments ? `${installment.number}/${installment.total_installments}` : `${installment.number}`;

  await knex.transaction(async (trx) => {
    if (!outsideAccounts) {
      await createMovement(trx, userId, {
        accountId,
        amount: -value,
        date,
        description: `${installment.recurrence_name} ${label}`,
        type: MOVEMENT_TYPES.expense,
        categoryId,
        sourceType: INSTALLMENT_SOURCE,
        sourceId: installmentId,
      });
    }
    await trx('recurrence_installments').where('id', installmentId).update({
      paid: true,
      paid_amount: value,
      paid_date: date,
      account_id: outsideAccounts ? null : accountId,
      outside_accounts: Boolean(outsideAccounts),
    });
  });
  return getRecurrence(userId, installment.recurrence_id);
}

export async function undoPayment(userId, installmentId) {
  const installment = await findInstallment(userId, installmentId);
  if (!bool(installment.paid)) throw new BadRequestError('This installment is not paid', 'NOT_PAID');
  if (bool(installment.paid_before_system)) {
    throw new BadRequestError('Installments paid before the system cannot be reopened', 'PAID_BEFORE_SYSTEM');
  }
  await knex.transaction(async (trx) => {
    await deleteMovements(trx, userId, INSTALLMENT_SOURCE, installmentId);
    await trx('recurrence_installments').where('id', installmentId).update({
      paid: false, paid_amount: null, paid_date: null, account_id: null, outside_accounts: false,
    });
  });
  return getRecurrence(userId, installment.recurrence_id);
}

/** Contas do mês (RF-RC-09): what falls due in the month plus what is still overdue. */
export async function monthBills(userId, month) {
  await extendOpenEnded(userId);
  const start = `${month}-01`;
  const end = shiftMonths(start, 1);
  const rows = await knex('recurrence_installments as i')
    .join('recurrences as r', 'r.id', 'i.recurrence_id')
    .where('r.user_id', userId)
    .where('i.paid_before_system', false)
    .where(function inMonthOrOverdue() {
      this.where(function inMonth() { this.where('i.due_date', '>=', start).where('i.due_date', '<', end); })
        .orWhere(function overdue() { this.where('i.due_date', '<', start).where('i.paid', false); });
    })
    .select('i.*', 'r.name', 'r.creditor', 'r.method', 'r.total_installments', 'r.default_account_id', 'r.category_id')
    .orderBy('i.due_date');
  const now = today();
  const bills = rows.map((row) => ({
    ...formatInstallment(row, now),
    name: row.name,
    creditor: row.creditor,
    method: row.method,
    totalInstallments: row.total_installments,
    defaultAccountId: row.default_account_id,
    categoryId: row.category_id,
  }));
  const sum = (list, pick) => money(list.reduce((total, item) => total + pick(item), 0));
  return {
    month,
    bills,
    totals: {
      due: sum(bills, (item) => item.amount),
      paid: sum(bills.filter((item) => item.paid), (item) => item.paidAmount || 0),
      open: sum(bills.filter((item) => !item.paid), (item) => item.amount),
      overdue: sum(bills.filter((item) => item.status === 'vencido'), (item) => item.amount),
    },
  };
}

export default {
  listRecurrences, getRecurrence, createRecurrence, updateRecurrence, adjustRecurrence, endRecurrence,
  deleteRecurrence, payInstallment, undoPayment, monthBills, INSTALLMENT_SOURCE,
};
