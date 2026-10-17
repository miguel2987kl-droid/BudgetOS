import Account from '../models/Account.js';
import { generateId, roundAmount } from '../utils/helpers.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';

/**
 * Account movements owned by a source record (RN-03): a balance only changes
 * through a movement, and undoing the source removes its movements.
 * Movements are rows of `transactions` tagged with source_type / source_id.
 */

export const MOVEMENT_TYPES = {
  income: 'income',
  expense: 'expense',
  transfer: 'transfer',
  // Credit of a card sale installment: settles a receivable, not a new income (RN-06).
  settlement: 'settlement',
};

export async function ensureAccount(db, userId, accountId) {
  const account = await db('accounts').where({ id: accountId, user_id: userId, is_active: true }).first();
  if (!account) throw new NotFoundError('Account not found', 'ACCOUNT_NOT_FOUND');
  return account;
}

/**
 * Create one movement and refresh the account balance. `amount` is signed:
 * positive enters the account, negative leaves it.
 */
export async function createMovement(trx, userId, movement) {
  const amount = roundAmount(movement.amount);
  if (amount === 0) throw new BadRequestError('Movement amount cannot be zero', 'MOVEMENT_ZERO');
  await ensureAccount(trx, userId, movement.accountId);
  const id = generateId();
  await trx('transactions').insert({
    id,
    user_id: userId,
    account_id: movement.accountId,
    category_id: movement.categoryId || null,
    amount,
    description: movement.description,
    date: movement.date,
    status: 'cleared',
    type: movement.type,
    linked_transaction_id: movement.linkedTransactionId || null,
    source_type: movement.sourceType,
    source_id: movement.sourceId,
  });
  await Account.updateBalance(movement.accountId, userId, trx);
  return id;
}

/** Move money between two own accounts; neither leg is income nor expense (RN-05). */
export async function createTransferMovements(trx, userId, { fromAccountId, toAccountId, amount, date, description, sourceType, sourceId }) {
  if (fromAccountId === toAccountId) throw new BadRequestError('Origin and destination must differ', 'SAME_ACCOUNT');
  const value = Math.abs(roundAmount(amount));
  const outId = await createMovement(trx, userId, {
    accountId: fromAccountId, amount: -value, date, description, type: MOVEMENT_TYPES.transfer, sourceType, sourceId,
  });
  const inId = await createMovement(trx, userId, {
    accountId: toAccountId, amount: value, date, description, type: MOVEMENT_TYPES.transfer, sourceType, sourceId, linkedTransactionId: outId,
  });
  await trx('transactions').where('id', outId).update({ linked_transaction_id: inId });
  return [outId, inId];
}

/** Remove every movement of a source record and refresh the touched balances. */
export async function deleteMovements(trx, userId, sourceType, sourceId) {
  const rows = await trx('transactions')
    .where({ user_id: userId, source_type: sourceType, source_id: sourceId })
    .select('id', 'account_id');
  if (rows.length === 0) return 0;
  await trx('transactions').whereIn('id', rows.map((row) => row.id)).del();
  for (const accountId of new Set(rows.map((row) => row.account_id))) {
    await Account.updateBalance(accountId, userId, trx);
  }
  return rows.length;
}

export default { createMovement, createTransferMovements, deleteMovements, ensureAccount, MOVEMENT_TYPES };
