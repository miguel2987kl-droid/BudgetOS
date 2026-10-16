import knex from '../database/connection.js';
import { formatDateISO, generateId, roundAmount } from '../utils/helpers.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import dateHelpers from '../database/dateHelpers.js';
import { buildUpdates } from '../utils/modelHelpers.js';

/**
 * Account model
 */
export class Account {
  /**
   * Create a new account
   */
  static async create(userId, data) {
    const id = generateId();

    await knex('accounts').insert({
      id, user_id: userId, name: data.name, type: data.type,
      institution: data.institution || null, account_number: data.accountNumber || null,
      initial_balance: data.initialBalance || 0, current_balance: data.initialBalance || 0,
      currency: data.currency || 'BRL', color: data.color || '#3B82F6',
      icon: data.icon || 'wallet',
      is_included_in_total: data.isIncludedInTotal !== false,
      notes: data.notes || null, sort_order: data.sortOrder || 0,
      holder_type: data.holderType || null, overdraft_limit: data.overdraftLimit || 0,
      balance_date: data.balanceDate || formatDateISO(new Date()),
    });

    return Account.findById(id, userId);
  }

  /**
   * Find account by ID (active accounts only)
   */
  static async findById(id, userId, trx = null) {
    const db = trx || knex;
    const account = await db('accounts')
      .where({ id, user_id: userId, is_active: true })
      .first();

    return account ? Account.format(account) : null;
  }

  /**
   * Find account by ID or throw (active accounts only)
   */
  static async findByIdOrFail(id, userId, trx = null) {
    const account = await Account.findById(id, userId, trx);
    if (!account) throw new NotFoundError('Account not found', 'ACCOUNT_NOT_FOUND');
    return account;
  }

  /**
   * Find account by ID regardless of is_active state.
   * Used by lifecycle endpoints (deactivate/reactivate/permanent delete)
   * which must operate on inactive rows.
   */
  static async findAnyByIdOrFail(id, userId) {
    const account = await knex('accounts')
      .where({ id, user_id: userId })
      .first();
    if (!account) throw new NotFoundError('Account not found', 'ACCOUNT_NOT_FOUND');
    return Account.format(account);
  }

  /**
   * List user accounts.
   * Defaults to active only. Pass includeInactive=true to also return
   * deactivated accounts (so the Accounts page can offer reactivate /
   * permanent-delete actions on them).
   */
  static async findByUser(userId, options = {}) {
    const { type, isActive, includeInactive = false, includeBalance = true, staleBalanceDays = null } = options;

    let query = knex('accounts').where('user_id', userId);
    if (type) query = query.where('type', type);
    if (isActive !== undefined) query = query.where('is_active', isActive);
    else if (!includeInactive) query = query.where('is_active', true);

    const accounts = await query.orderBy('sort_order', 'asc').orderBy('name', 'asc');

    let totals = null;
    if (includeBalance) {
      totals = await Account.calculateTotals(userId);
    }

    const cardsByAccount = await Account.linkedCardsByAccount(userId);
    const data = accounts.map((row) => ({
      ...Account.format(row),
      linkedCards: cardsByAccount.get(row.id) || [],
      isBalanceStale: Account.isBalanceStale(row, staleBalanceDays),
    }));

    return { data, totals };
  }

  /**
   * Cards attached to each account, as payment account or card account (RF-CT: cartão vinculado).
   */
  static async linkedCardsByAccount(userId) {
    const cards = await knex('credit_cards')
      .where({ user_id: userId, is_active: true })
      .select('id', 'name', 'account_id', 'linked_account_id', 'card_number_last4');
    const map = new Map();
    for (const card of cards) {
      for (const accountId of new Set([card.account_id, card.linked_account_id].filter(Boolean))) {
        if (!map.has(accountId)) map.set(accountId, []);
        map.get(accountId).push({ id: card.id, name: card.name, last4: card.card_number_last4 });
      }
    }
    return map;
  }

  /** A balance is stale when it has not been confirmed within the workspace's window. */
  static isBalanceStale(row, staleBalanceDays, today = new Date()) {
    if (!staleBalanceDays || !row.is_active || row.type === 'credit_card') return false;
    if (!row.balance_date) return true;
    const confirmed = new Date(`${String(row.balance_date).slice(0, 10)}T00:00:00Z`);
    const ageDays = Math.floor((Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - confirmed.getTime()) / 86400000);
    return ageDays > staleBalanceDays;
  }

  /**
   * Batch balance update (RF-CT, RN-03). The informed balance is never written
   * directly: each difference becomes an adjustment movement on the account,
   * so the ledger keeps explaining every change. The balance date is set even
   * when nothing differs, which confirms the balance.
   */
  static async updateBalances(userId, { date, items }) {
    const results = [];
    await knex.transaction(async (trx) => {
      for (const item of items) {
        const account = await trx('accounts').where({ id: item.accountId, user_id: userId, is_active: true }).first();
        if (!account) throw new NotFoundError('Account not found', 'ACCOUNT_NOT_FOUND');

        const previousBalance = await Account.updateBalance(account.id, userId, trx);
        const difference = roundAmount(Number(item.balance) - previousBalance);
        let adjustmentId = null;
        if (difference !== 0) {
          adjustmentId = generateId();
          await trx('transactions').insert({
            id: adjustmentId,
            user_id: userId,
            account_id: account.id,
            amount: difference,
            description: 'Ajuste de saldo',
            date,
            status: 'cleared',
            type: 'adjustment',
            notes: item.note || null,
          });
        }
        await trx('accounts').where('id', account.id).update({ balance_date: date });
        const newBalance = await Account.updateBalance(account.id, userId, trx);
        results.push({ accountId: account.id, previousBalance, newBalance, difference, adjustmentId });
      }
    });
    return results;
  }

  /**
   * Calculate account totals
   */
  static async calculateTotals(userId) {
    const result = await knex('accounts')
      .where({ user_id: userId, is_active: true })
      .select(
        knex.raw('SUM(CASE WHEN is_included_in_total = true THEN current_balance ELSE 0 END) as total_balance'),
        knex.raw("SUM(CASE WHEN type IN ('checking', 'savings', 'cash') AND is_included_in_total = true THEN current_balance ELSE 0 END) as available_balance"),
        knex.raw("SUM(CASE WHEN type = 'investment' AND is_included_in_total = true THEN current_balance ELSE 0 END) as investment_balance"),
        knex.raw('COUNT(*) as account_count'),
      )
      .first();

    return {
      totalBalance: roundAmount(result?.total_balance || 0),
      availableBalance: roundAmount(result?.available_balance || 0),
      investmentBalance: roundAmount(result?.investment_balance || 0),
      accountCount: Number(result?.account_count || 0),
    };
  }

  /**
   * Update account
   */
  static async update(id, userId, data) {
    await Account.findByIdOrFail(id, userId);

    const allowedFields = [
      'name', 'type', 'institution', 'account_number', 'currency',
      'color', 'icon', 'is_included_in_total', 'notes', 'sort_order',
      'holder_type', 'overdraft_limit',
    ];

    const updates = buildUpdates(data, allowedFields);

    if (Object.keys(updates).length > 0) {
      await knex('accounts').where({ id, user_id: userId }).update(updates);
    }

    return Account.findById(id, userId);
  }

  /**
   * Recalculate account balance from transactions
   */
  static async updateBalance(id, userId, trx = null) {
    const db = trx || knex;
    const account = await db('accounts')
      .where({ id, user_id: userId, is_active: true })
      .first();

    if (!account) return 0;

    const result = await db('transactions')
      .where({ account_id: id, user_id: userId })
      .whereNot('status', 'void')
      .sum('amount as transactions_sum')
      .first();

    const newBalance = roundAmount(Number(account.initial_balance) + Number(result?.transactions_sum || 0));
    await db('accounts').where('id', id).update({ current_balance: newBalance });

    return newBalance;
  }

  /**
   * Recalculate all balances for a user
   */
  static async recalculateAllBalances(userId) {
    const accounts = await knex('accounts')
      .where({ user_id: userId, is_active: true })
      .select('id');

    for (const account of accounts) {
      await Account.updateBalance(account.id, userId);
    }
  }

  /**
   * Deactivate an account (reversible).
   * Hides the account from totals/lists/forecasts and pauses its planned
   * transactions. Existing transactions are kept.
   */
  static async deactivate(id, userId) {
    const account = await Account.findAnyByIdOrFail(id, userId);
    if (!account.isActive) return { deactivated: true, alreadyInactive: true };

    await knex('planned_transactions')
      .where('user_id', userId)
      .where(function () {
        this.where('account_id', id).orWhere('to_account_id', id);
      })
      .update({ is_active: false });

    await knex('accounts').where({ id, user_id: userId }).update({ is_active: false });
    return { deactivated: true, alreadyInactive: false };
  }

  /**
   * Reactivate a previously deactivated account.
   * Planned transactions are NOT auto-reactivated; the user re-enables
   * the ones they actually want.
   */
  static async reactivate(id, userId) {
    const account = await Account.findAnyByIdOrFail(id, userId);
    if (account.isActive) return { reactivated: true, alreadyActive: true };

    await knex('accounts').where({ id, user_id: userId }).update({ is_active: true });
    // Recompute the balance now that the account is active again (updateBalance
    // is a no-op on inactive accounts, so it could not run while deactivated).
    await Account.updateBalance(id, userId);
    return { reactivated: true, alreadyActive: false };
  }

  /**
   * Permanent (hard) delete an account and all its data.
   * Refused unless the account is already deactivated, to force the user
   * through an explicit two-step intent. Cascading FKs remove transactions,
   * splits and planned transactions tied to the account.
   */
  static async delete(id, userId) {
    const account = await Account.findAnyByIdOrFail(id, userId);
    if (account.isActive) {
      throw new BadRequestError(
        'Account must be deactivated before permanent deletion',
        'ACCOUNT_MUST_BE_DEACTIVATED'
      );
    }

    await knex('accounts').where({ id, user_id: userId }).del();
    return { deleted: true };
  }

  /**
   * Get account statistics
   */
  static async getStats(id, userId, period = 'month') {
    await Account.findByIdOrFail(id, userId);

    let query = knex('transactions')
      .where({ account_id: id, user_id: userId })
      .whereNot('status', 'void');

    switch (period) {
      case 'week':
        query = query.whereRaw(dateHelpers.dateWithinLastDays(knex, 'date', 7).toString());
        break;
      case 'month':
        query = query.whereRaw(`date >= ${dateHelpers.startOfMonth(knex).toString()}`);
        break;
      case 'year':
        query = query.whereRaw(`date >= ${dateHelpers.startOfYear(knex).toString()}`);
        break;
    }

    const stats = await query.select(
      knex.raw('COUNT(*) as transaction_count'),
      knex.raw('SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as total_income'),
      knex.raw('SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as total_expenses'),
      knex.raw('AVG(amount) as average_transaction'),
    ).first();

    return {
      transactionCount: Number(stats?.transaction_count || 0),
      totalIncome: roundAmount(stats?.total_income || 0),
      totalExpenses: roundAmount(stats?.total_expenses || 0),
      netFlow: roundAmount(Number(stats?.total_income || 0) - Number(stats?.total_expenses || 0)),
      averageTransaction: roundAmount(stats?.average_transaction || 0),
    };
  }

  /**
   * Format account for API response
   */
  static format(account) {
    return {
      id: account.id,
      userId: account.user_id,
      name: account.name,
      type: account.type,
      institution: account.institution,
      accountNumber: account.account_number,
      initialBalance: Number(account.initial_balance),
      currentBalance: Number(account.current_balance),
      currency: account.currency,
      color: account.color,
      icon: account.icon,
      isActive: Boolean(account.is_active),
      isIncludedInTotal: Boolean(account.is_included_in_total),
      holderType: account.holder_type || null,
      overdraftLimit: Number(account.overdraft_limit || 0),
      availableWithOverdraft: roundAmount(Number(account.current_balance) + Number(account.overdraft_limit || 0)),
      balanceDate: account.balance_date ? String(account.balance_date).slice(0, 10) : null,
      notes: account.notes,
      sortOrder: account.sort_order,
      createdAt: account.created_at,
      updatedAt: account.updated_at,
    };
  }
}

export default Account;
