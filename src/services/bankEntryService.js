import knex from '../database/connection.js';
import { generateId } from '../utils/helpers.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';
import { MOVEMENT_TYPES, createMovement, createTransferMovements, deleteMovements, ensureAccount } from './movementService.js';
import { ensureCategory, isoDate, money } from './operationsCommon.js';

/**
 * Bank entries (E4, RF-EB). An entry is money arriving in an account; with an
 * origin account it is a transfer between own accounts and never revenue (RN-05).
 */

export const ENTRY_SOURCE = 'bank_entry';

const format = (row) => ({
  id: row.id,
  accountId: row.account_id,
  accountName: row.account_name || null,
  institution: row.institution || null,
  originAccountId: row.origin_account_id,
  originAccountName: row.origin_account_name || null,
  isTransfer: Boolean(row.origin_account_id),
  description: row.description,
  payer: row.payer,
  document: row.document,
  amount: money(row.amount),
  date: isoDate(row.date),
  method: row.method,
  categoryId: row.category_id,
  categoryName: row.category_name || null,
});

const entryQuery = (userId) => knex('bank_entries as e')
  .leftJoin('accounts as a', 'a.id', 'e.account_id')
  .leftJoin('accounts as o', 'o.id', 'e.origin_account_id')
  .leftJoin('categories as c', 'c.id', 'e.category_id')
  .where('e.user_id', userId)
  .select('e.*', 'a.name as account_name', 'a.institution', 'o.name as origin_account_name', 'c.name as category_name');

export async function getEntry(userId, entryId) {
  const row = await entryQuery(userId).where('e.id', entryId).first();
  if (!row) throw new NotFoundError('Bank entry not found', 'BANK_ENTRY_NOT_FOUND');
  return format(row);
}

/** RF-EB-04: an entry with the same account, amount and date may be a duplicate. */
export async function findDuplicates(userId, { accountId, amount, date }, excludeId = null) {
  const rows = await knex('transactions')
    .where({ user_id: userId, account_id: accountId, date })
    .where('amount', money(amount))
    .whereNot('status', 'void')
    .modify((query) => {
      if (excludeId) query.where(function notThisEntry() { this.whereNull('source_id').orWhereNot('source_id', excludeId); });
    })
    .select('id', 'description', 'amount', 'date', 'source_type');
  return rows.map((row) => ({ id: row.id, description: row.description, amount: money(row.amount), date: isoDate(row.date), sourceType: row.source_type }));
}

async function writeMovements(trx, userId, id, data) {
  if (data.originAccountId) {
    await createTransferMovements(trx, userId, {
      fromAccountId: data.originAccountId,
      toAccountId: data.accountId,
      amount: data.amount,
      date: data.date,
      description: data.description,
      sourceType: ENTRY_SOURCE,
      sourceId: id,
    });
    return;
  }
  await createMovement(trx, userId, {
    accountId: data.accountId,
    amount: Math.abs(money(data.amount)),
    date: data.date,
    description: data.description,
    type: MOVEMENT_TYPES.income,
    categoryId: data.categoryId || null,
    sourceType: ENTRY_SOURCE,
    sourceId: id,
  });
}

const checkInputs = async (userId, data, excludeId = null) => {
  await ensureAccount(knex, userId, data.accountId);
  if (data.originAccountId) await ensureAccount(knex, userId, data.originAccountId);
  await ensureCategory(knex, userId, data.categoryId);
  if (!data.confirmDuplicate) {
    const duplicates = await findDuplicates(userId, data, excludeId);
    if (duplicates.length > 0) {
      const error = new ConflictError('There is already an entry with the same account, amount and date', 'POSSIBLE_DUPLICATE');
      error.details = { duplicates };
      throw error;
    }
  }
};

const toRow = (data) => ({
  account_id: data.accountId,
  origin_account_id: data.originAccountId || null,
  description: data.description,
  payer: data.payer || null,
  document: data.document || null,
  amount: Math.abs(money(data.amount)),
  date: data.date,
  method: data.method || null,
  category_id: data.categoryId || null,
});

export async function createEntry(userId, data) {
  await checkInputs(userId, data);
  const id = generateId();
  await knex.transaction(async (trx) => {
    await trx('bank_entries').insert({ id, user_id: userId, ...toRow(data) });
    await writeMovements(trx, userId, id, data);
  });
  return getEntry(userId, id);
}

/** Editing replaces the movements, so the balance takes the difference (RN-03). */
export async function updateEntry(userId, entryId, data) {
  const current = await getEntry(userId, entryId);
  const merged = { ...current, ...data };
  const valuesChanged = ['accountId', 'originAccountId', 'amount', 'date'].some((key) => data[key] !== undefined && data[key] !== current[key]);
  await checkInputs(userId, { ...merged, confirmDuplicate: data.confirmDuplicate || !valuesChanged }, entryId);
  await knex.transaction(async (trx) => {
    await trx('bank_entries').where('id', entryId).update({ ...toRow(merged), updated_at: new Date() });
    await deleteMovements(trx, userId, ENTRY_SOURCE, entryId);
    await writeMovements(trx, userId, entryId, merged);
  });
  return getEntry(userId, entryId);
}

export async function deleteEntry(userId, entryId) {
  const entry = await getEntry(userId, entryId);
  await knex.transaction(async (trx) => {
    await deleteMovements(trx, userId, ENTRY_SOURCE, entryId);
    await trx('bank_entries').where('id', entryId).del();
  });
  return entry;
}

/** List plus the per-bank view of RF-EB-06. */
export async function listEntries(userId, { from, to, accountId, includeTransfers = true } = {}) {
  const rows = await entryQuery(userId)
    .modify((query) => {
      if (from) query.where('e.date', '>=', from);
      if (to) query.where('e.date', '<=', to);
      if (accountId) query.where('e.account_id', accountId);
      if (!includeTransfers) query.whereNull('e.origin_account_id');
    })
    .orderBy('e.date', 'desc');
  const entries = rows.map(format);

  const banks = new Map();
  for (const entry of entries) {
    const key = entry.accountId;
    const bank = banks.get(key) || { accountId: key, accountName: entry.accountName, institution: entry.institution, entries: 0, total: 0, transfers: 0 };
    bank.entries += 1;
    if (entry.isTransfer) bank.transfers = money(bank.transfers + entry.amount);
    else bank.total = money(bank.total + entry.amount);
    banks.set(key, bank);
  }
  return {
    entries,
    byBank: [...banks.values()].sort((a, b) => b.total - a.total),
    totals: {
      entries: money(entries.filter((entry) => !entry.isTransfer).reduce((sum, entry) => sum + entry.amount, 0)),
      transfers: money(entries.filter((entry) => entry.isTransfer).reduce((sum, entry) => sum + entry.amount, 0)),
    },
  };
}

export default { createEntry, updateEntry, deleteEntry, getEntry, listEntries, findDuplicates, ENTRY_SOURCE };
