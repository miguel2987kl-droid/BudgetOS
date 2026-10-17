import knex from '../database/connection.js';
import dateHelpers from '../database/dateHelpers.js';
import { generateId, formatDateISO } from '../utils/helpers.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import Account from './Account.js';
import { buildUpdates, paginationMeta } from '../utils/modelHelpers.js';

function installmentDate(dateValue, offset) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const targetMonth = month - 1 + offset;
  const lastDay = new Date(year, targetMonth + 1, 0).getDate();
  return formatDateISO(new Date(year, targetMonth, Math.min(day, lastDay)));
}

/**
 * Insert a linked (destination) transaction for a transfer and update the main transaction link.
 * @param {Object} trx - Knex transaction
 * @param {string} sourceId - Source transaction ID
 * @param {string} userId - User ID
 * @param {string} toAccountId - Destination account ID
 * @param {Object} data - Incoming update data
 * @param {Object} tx - Existing transaction being updated
 * @param {number|null} newAmount - New signed amount (or null to keep existing)
 */
async function insertLinkedTransaction(trx, sourceId, userId, toAccountId, data, tx, newAmount) {
  const newLinkedId = generateId();
  const amount = newAmount !== null ? Math.abs(newAmount) : Math.abs(tx.amount);
  await trx('transactions').insert({
    id: newLinkedId,
    user_id: userId,
    account_id: toAccountId,
    category_id: data.categoryId !== undefined ? data.categoryId : tx.categoryId,
    payee_id: data.payeeId !== undefined ? data.payeeId : tx.payeeId,
    amount,
    description: data.description || tx.description,
    notes: data.notes !== undefined ? data.notes : tx.notes,
    date: data.date || tx.date,
    status: data.status || tx.status,
    type: 'transfer',
    linked_transaction_id: sourceId,
  });
  await trx('transactions').where('id', sourceId).update({ linked_transaction_id: newLinkedId });
  await Account.updateBalance(toAccountId, userId, trx);
}

/**
 * Transaction model
 */
export class Transaction {
  /**
   * Validate that referenced category / payee / credit card belong to the user.
   * Categories may also be system-wide (null user_id). Prevents referencing
   * another user's objects (cross-tenant info leak).
   */
  static async validateReferences(userId, data) {
    if (data.categoryId) {
      const cat = await knex('categories')
        .where('id', data.categoryId)
        .where(function () { this.where('user_id', userId).orWhereNull('user_id'); })
        .first();
      if (!cat) throw new NotFoundError('Category not found', 'CATEGORY_NOT_FOUND');
    }
    if (data.payeeId) {
      const payee = await knex('payees').where({ id: data.payeeId, user_id: userId }).first();
      if (!payee) throw new NotFoundError('Payee not found', 'PAYEE_NOT_FOUND');
    }
    if (data.creditCardId) {
      const cc = await knex('credit_cards').where({ id: data.creditCardId, user_id: userId }).first();
      if (!cc) throw new NotFoundError('Credit card not found', 'CREDIT_CARD_NOT_FOUND');
    }
  }

  /**
   * Create a new transaction
   */
  static async create(userId, data) {
    const id = generateId();
    await Transaction.validateReferences(userId, data);
    const installmentCount = data.installmentCount || 1;
    const card = data.creditCardId
      ? await knex('credit_cards').where({ id: data.creditCardId, user_id: userId }).first()
      : null;

    if (installmentCount > 1 && (!card || data.type !== 'expense' || card.debit_type !== 'deferred')) {
      throw new BadRequestError('Installments require an expense on a deferred credit card', 'INSTALLMENTS_REQUIRE_CREDIT_CARD');
    }

    // Handle external source transfer (no source account, only destination)
    if (data.type === 'transfer' && !data.accountId && data.toAccountId) {
      await Account.findByIdOrFail(data.toAccountId, userId);

      await knex.transaction(async (trx) => {
        // Create transaction on destination account with positive amount
        await trx('transactions').insert({
          id,
          user_id: userId,
          account_id: data.toAccountId,
          category_id: data.categoryId || null,
          payee_id: data.payeeId || null,
          amount: Math.abs(data.amount),
          description: data.description,
          notes: data.notes || null,
          date: data.date,
          status: data.status || 'pending',
          type: 'transfer',
        });

        await Account.updateBalance(data.toAccountId, userId, trx);
      });

      return Transaction.findById(id, userId);
    }

    // Standard flow: source account exists
    await Account.findByIdOrFail(data.accountId, userId);

    // Adjust amount sign based on type
    let amount = Math.abs(data.amount);
    if (data.type === 'expense' || data.type === 'transfer') {
      amount = -amount; // Debit for expenses and transfers (source account)
    }

    const installmentGroupId = installmentCount > 1 ? generateId() : null;
    const totalCents = Math.round(Math.abs(data.amount) * 100);
    const baseCents = Math.floor(totalCents / installmentCount);
    const remainderCents = totalCents % installmentCount;
    const installmentIds = [];
    const installmentRows = [];

    await knex.transaction(async (trx) => {
      for (let index = 0; index < installmentCount; index += 1) {
        const transactionId = index === 0 ? id : generateId();
        const installmentAmount = installmentCount === 1
          ? amount
          : -((baseCents + (index < remainderCents ? 1 : 0)) / 100);
        installmentIds.push(transactionId);
        installmentRows.push({
          id: transactionId,
          user_id: userId,
          account_id: data.accountId,
          category_id: data.categoryId || null,
          payee_id: data.payeeId || null,
          credit_card_id: data.creditCardId || null,
          amount: installmentAmount,
          description: data.description,
          notes: data.notes || null,
          date: installmentCount === 1 ? data.date : installmentDate(data.date, index),
          purchase_date: data.purchaseDate || (installmentCount > 1 ? data.date : null),
          value_date: data.valueDate || null,
          status: data.status || 'pending',
          type: data.type,
          is_split: !!data.isSplit,
          is_recurring: !!data.isRecurring,
          recurring_id: data.recurringId || null,
          tags: data.tags ? JSON.stringify(data.tags) : null,
          check_number: data.checkNumber || null,
          import_hash: data.importHash || null,
          installment_group_id: installmentGroupId,
          installment_number: installmentCount > 1 ? index + 1 : null,
          installment_count: installmentCount > 1 ? installmentCount : null,
        });
      }

      await trx('transactions').insert(installmentRows);

      // Update source account balance
      await Account.updateBalance(data.accountId, userId, trx);

      // Handle transfers with destination account
      if (data.type === 'transfer' && data.toAccountId) {
        await Account.findByIdOrFail(data.toAccountId, userId, trx);
        const transferId = generateId();

        await trx('transactions').insert({
          id: transferId,
          user_id: userId,
          account_id: data.toAccountId,
          category_id: data.categoryId || null,
          payee_id: data.payeeId || null,
          amount: Math.abs(amount),
          description: data.description,
          date: data.date,
          status: data.status || 'pending',
          type: 'transfer',
          linked_transaction_id: id,
        });

        // Update source transaction with link to destination transaction
        await trx('transactions').where('id', id).update({ linked_transaction_id: transferId });

        await Account.updateBalance(data.toAccountId, userId, trx);
      }
    });

    if (card?.debit_type === 'deferred') {
      const { default: CreditCard } = await import('./CreditCard.js');
      await CreditCard.assignTransactionsToCycles(installmentIds, data.creditCardId, userId);
    }

    const createdTransaction = await Transaction.findById(installmentIds[0], userId);
    return createdTransaction;
  }

  /**
   * Find a transaction by ID
   */
  static async findById(id, userId) {
    const tx = await knex('transactions as t')
      .leftJoin('categories as c', 't.category_id', 'c.id')
      .leftJoin('accounts as a', 't.account_id', 'a.id')
      .where('t.id', id)
      .andWhere('t.user_id', userId)
      .select('t.*', 'c.name as category_name', 'a.name as account_name')
      .first();

    return tx ? Transaction.format(tx) : null;
  }

  /**
   * Find a transaction by ID or throw
   */
  static async findByIdOrFail(id, userId) {
    const tx = await Transaction.findById(id, userId);
    if (!tx) {
      throw new NotFoundError('Transaction not found', 'TRANSACTION_NOT_FOUND');
    }
    return tx;
  }

  /**
   * List transactions with filters
   */
  static async findByUser(userId, options = {}) { // lgtm[js/sensitive-get-query]
    const {
      accountId, categoryId, creditCardId, type, status, isReconciled,
      startDate, endDate, minAmount, maxAmount, search,
      page = 1, limit = 50, sortBy = 'date', sortOrder = 'desc'
    } = options;

    // Build filter function to apply identical WHERE clauses to both count and data queries
    const applyFilters = (query) => {
      if (accountId) query = query.andWhere('t.account_id', accountId);
      if (categoryId) query = query.andWhere('t.category_id', categoryId);
      if (creditCardId) query = query.andWhere('t.credit_card_id', creditCardId);
      if (type) query = query.andWhere('t.type', type);
      if (status) query = query.andWhere('t.status', status);
      if (isReconciled !== undefined) query = query.andWhere('t.is_reconciled', isReconciled === 'true');
      if (startDate) query = query.andWhere('t.date', '>=', startDate);
      if (endDate) query = query.andWhere('t.date', '<=', endDate);
      if (minAmount !== undefined) query = query.andWhereRaw('ABS(t.amount) >= ?', [minAmount]);
      if (maxAmount !== undefined) query = query.andWhereRaw('ABS(t.amount) <= ?', [maxAmount]);
      if (search) {
        const likeOp = dateHelpers.likeOperator(knex);
        query = query.andWhere(function () {
          this.where('t.description', likeOp, `%${search}%`)
            .orWhere('t.notes', likeOp, `%${search}%`)
            .orWhere('t.check_number', likeOp, `%${search}%`);
        });
      }
      return query;
    };

    // Count query: no JOINs needed, only filters on the transactions table
    const countQuery = applyFilters(knex('transactions as t').where('t.user_id', userId));
    const countResult = await countQuery.count('* as count').first();
    const total = countResult?.count || 0;

    // Data query: needs JOINs for category, account, payee and linked transaction names
    let dataQuery = applyFilters(
      knex('transactions as t')
        .leftJoin('categories as c', 't.category_id', 'c.id')
        .leftJoin('accounts as a', 't.account_id', 'a.id')
        .leftJoin('payees as p', 't.payee_id', 'p.id')
        .leftJoin('transactions as linked_tx', 't.linked_transaction_id', 'linked_tx.id')
        .leftJoin('accounts as linked_a', 'linked_tx.account_id', 'linked_a.id')
        .where('t.user_id', userId)
    ).select(
      't.*',
      'c.name as category_name',
      'c.icon as category_icon',
      'c.color as category_color',
      'a.name as account_name',
      'p.name as payee_name',
      'p.image_url as payee_image_url',
      'linked_tx.account_id as linked_account_id',
      'linked_a.name as linked_account_name'
    );

    // Sorting and pagination
    const allowedSortFields = {
      date: 't.date',
      amount: 't.amount',
      description: 't.description',
      created_at: 't.created_at',
      payee: 'p.name',
      category: 'c.name',
      account: 'a.name',
    };
    const sortField = allowedSortFields[sortBy] || 't.date';
    const direction = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const isNullableField = ['payee', 'category', 'account'].includes(sortBy);

    if (isNullableField) {
      dataQuery = dataQuery.orderByRaw(dateHelpers.nullsLast(knex, sortField, direction).toString());
    } else {
      dataQuery = dataQuery.orderBy(sortField, direction);
    }

    dataQuery = dataQuery.limit(limit).offset((page - 1) * limit);

    const transactions = await dataQuery;

    return {
      data: transactions.map(Transaction.format),
      pagination: paginationMeta(page, limit, total),
    };
  }

  /**
   * Update a transaction
   * For transfers, also updates the linked transaction
   */
  static async update(id, userId, data) {
    const tx = await Transaction.findByIdOrFail(id, userId);
    if (tx.sourceType) {
      throw new BadRequestError('This movement belongs to another record; change it there', 'TRANSACTION_HAS_SOURCE');
    }
    await Transaction.validateReferences(userId, data);
    const oldAccountId = tx.accountId;
    const isTransfer = tx.type === 'transfer' || data.type === 'transfer';

    // Get linked transaction if it's a transfer
    const linkedTx = tx.linkedTransactionId
      ? await knex('transactions').where('id', tx.linkedTransactionId).first()
      : null;
    const oldLinkedAccountId = linkedTx?.account_id;

    // Special case: Converting to external source transfer (accountId = null, toAccountId set)
    const hasAccountId = 'accountId' in data;
    const hasToAccountId = 'toAccountId' in data;
    if (isTransfer && hasAccountId && !data.accountId && hasToAccountId && data.toAccountId) {
      await Account.findByIdOrFail(data.toAccountId, userId);
      const newAmount = data.amount !== undefined ? Math.abs(data.amount) : Math.abs(tx.amount);

      await knex.transaction(async (trx) => {
        // Update main transaction to destination account with positive amount
        await trx('transactions')
          .where({ id, user_id: userId })
          .update({
            account_id: data.toAccountId,
            amount: newAmount,
            linked_transaction_id: null,
            category_id: data.categoryId !== undefined ? data.categoryId : tx.categoryId,
            payee_id: data.payeeId !== undefined ? data.payeeId : tx.payeeId,
            description: data.description || tx.description,
            date: data.date || tx.date,
            status: data.status || tx.status,
          });

        // Delete linked transaction if exists
        if (linkedTx) {
          await trx('transactions').where('id', linkedTx.id).del();
          await Account.updateBalance(linkedTx.account_id, userId, trx);
        }

        // Update balances
        await Account.updateBalance(oldAccountId, userId, trx);
        await Account.updateBalance(data.toAccountId, userId, trx);
      });

      return Transaction.findById(id, userId);
    }

    const allowedFields = [
      'account_id', 'category_id', 'payee_id', 'credit_card_id', 'amount', 'description',
      'notes', 'date', 'value_date', 'purchase_date', 'status', 'type', 'tags', 'check_number'
    ];

    // Fields that should be synced to linked transaction
    const syncFields = ['category_id', 'payee_id', 'description', 'notes', 'date', 'status'];

    // Calculate amount with correct sign. Recompute when the amount OR the type
    // changes, so a type change alone (e.g. expense -> income) fixes the sign.
    let newAmount = null;
    const typeChanged = data.type !== undefined && data.type !== tx.type;
    if (data.amount !== undefined || typeChanged) {
      const type = data.type || tx.type;
      const magnitude = data.amount !== undefined ? Math.abs(data.amount) : Math.abs(tx.amount);
      if (type === 'expense') {
        newAmount = -magnitude;
      } else if (type === 'transfer') {
        // Preserve this leg's direction: the outgoing leg is negative, the
        // incoming (destination) leg is positive. Editing either must not flip it.
        newAmount = tx.amount < 0 ? -magnitude : magnitude;
      } else {
        newAmount = magnitude; // income
      }
    }

    const updates = buildUpdates(data, allowedFields, { jsonFields: ['tags'] });
    if (data.creditCardId !== undefined && data.creditCardId !== tx.creditCardId) {
      updates.credit_card_cycle_id = null;
      updates.accounting_date = null;
    }
    if (newAmount !== null) {
      updates.amount = newAmount;
    }

    // Build linked transaction updates from synced fields
    const linkedUpdatesObj = {};
    for (const [key, value] of Object.entries(data)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (syncFields.includes(dbKey)) {
        linkedUpdatesObj[dbKey] = value;
      }
    }

    // Handle amount for linked transaction (opposite sign of the edited leg)
    if (newAmount !== null && linkedTx) {
      linkedUpdatesObj.amount = -newAmount;
    }

    await knex.transaction(async (trx) => {
      // Update main transaction
      if (Object.keys(updates).length > 0) {
        await trx('transactions')
          .where({ id, user_id: userId })
          .update(updates);
      }

      // Handle transfer-specific logic
      if (isTransfer) {
        const newToAccountId = data.toAccountId;
        const hasToAccountIdInner = 'toAccountId' in data;

        // Case 1: toAccountId is explicitly set to null or empty - remove linked transaction
        if (hasToAccountIdInner && !newToAccountId && linkedTx) {
          await trx('transactions').where('id', id).update({ linked_transaction_id: null });
          await trx('transactions').where('id', linkedTx.id).del();
          await Account.updateBalance(linkedTx.account_id, userId, trx);
        }
        // Case 2: toAccountId changed to a different account - delete old, create new
        else if (hasToAccountIdInner && newToAccountId && linkedTx && newToAccountId !== linkedTx.account_id) {
          await trx('transactions').where('id', linkedTx.id).del();
          await Account.updateBalance(linkedTx.account_id, userId, trx);
          await insertLinkedTransaction(trx, id, userId, newToAccountId, data, tx, newAmount);
        }
        // Case 3: toAccountId provided but no linked transaction exists - create new
        else if (hasToAccountIdInner && newToAccountId && !linkedTx) {
          await insertLinkedTransaction(trx, id, userId, newToAccountId, data, tx, newAmount);
        }
        // Case 4: Linked transaction exists and no account change - just update it
        else if (linkedTx && Object.keys(linkedUpdatesObj).length > 0) {
          await trx('transactions')
            .where('id', linkedTx.id)
            .update(linkedUpdatesObj);
        }
      }

      // Update account balances
      await Account.updateBalance(oldAccountId, userId, trx);
      if (data.accountId && data.accountId !== oldAccountId) {
        await Account.updateBalance(data.accountId, userId, trx);
      }
      if (oldLinkedAccountId) {
        await Account.updateBalance(oldLinkedAccountId, userId, trx);
      }
    });

    if (data.creditCardId !== undefined || data.date !== undefined || data.purchaseDate !== undefined || data.status !== undefined) {
      const updated = await knex('transactions').where({ id, user_id: userId }).first();
      const { default: CreditCard } = await import('./CreditCard.js');
      if (updated?.credit_card_id) await CreditCard.assignTransactionToCycle(id, updated.credit_card_id, userId);
      if (tx.creditCardCycleId) await CreditCard.recalculateCycleTotal(tx.creditCardCycleId);
    }

    return Transaction.findById(id, userId);
  }

  /**
   * Delete a transaction
   */
  static async delete(id, userId) {
    const tx = await Transaction.findByIdOrFail(id, userId);
    if (tx.sourceType) {
      throw new BadRequestError('This movement belongs to another record; change it there', 'TRANSACTION_HAS_SOURCE');
    }

    // Get linked transaction if it's a transfer
    const linkedTx = tx.linkedTransactionId
      ? await knex('transactions').where('id', tx.linkedTransactionId).first()
      : null;

    await knex.transaction(async (trx) => {
      // Delete associated splits
      await trx('transaction_splits').where('transaction_id', id).del();

      // Delete linked transactions (legacy method with parent)
      await trx('transactions').where('parent_transaction_id', id).del();

      // Delete linked transaction (transfers)
      if (linkedTx) {
        await trx('transactions').where('id', linkedTx.id).del();
        await Account.updateBalance(linkedTx.account_id, userId, trx);
      }

      // Delete the transaction
      await trx('transactions').where({ id, user_id: userId }).del();

      // Update balance
      await Account.updateBalance(tx.accountId, userId, trx);
    });

    if (tx.creditCardCycleId) {
      const { default: CreditCard } = await import('./CreditCard.js');
      await CreditCard.recalculateCycleTotal(tx.creditCardCycleId);
    }

    return { deleted: true };
  }

  /**
   * Reconcile transactions
   */
  static async reconcile(userId, transactionIds, reconcileDate) {
    const reconciled = await knex('transactions')
      .where('user_id', userId)
      .whereIn('id', transactionIds)
      .update({
        status: 'reconciled',
        is_reconciled: true,
        reconciled_at: reconcileDate,
      });

    return { reconciled };
  }

  /**
   * Toggle reconciliation status of a single transaction
   * @param {string} userId - User ID
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<Object>} Updated transaction with new reconciliation status
   */
  static async toggleReconcile(userId, transactionId) {
    const tx = await Transaction.findByIdOrFail(transactionId, userId);
    const isCurrentlyReconciled = tx.isReconciled;
    if (isCurrentlyReconciled) {
      // Unreconcile: set status back to 'cleared' and remove reconciliation
      await knex('transactions')
        .where({ id: transactionId, user_id: userId })
        .update({
          status: 'cleared',
          is_reconciled: false,
          reconciled_at: null,
        });
    } else {
      // Reconcile: set status to 'reconciled'
      await knex('transactions')
        .where({ id: transactionId, user_id: userId })
        .update({
          status: 'reconciled',
          is_reconciled: true,
          reconciled_at: knex.fn.now(),
        });
    }

    return Transaction.findById(transactionId, userId);
  }

  /**
   * Find candidate transactions for manual import matching.
   * Exact amount match, ±90 days range, sorted by date proximity.
   */
  static async findMatchCandidates(userId, accountId, criteria) {
    const { amount, date } = criteria;

    const transactions = await knex('transactions as t')
      .leftJoin('categories as c', 't.category_id', 'c.id')
      .leftJoin('accounts as a', 't.account_id', 'a.id')
      .leftJoin('payees as p', 't.payee_id', 'p.id')
      .where('t.user_id', userId)
      .andWhere('t.account_id', accountId)
      .andWhere('t.is_reconciled', false)
      .andWhereNot('t.status', 'void')
      .andWhereRaw('ABS(t.amount) = ABS(?)', [amount])
      .andWhereRaw(dateHelpers.dateTolerance(knex, 't.date', date, 90).toString())
      .select(
        't.*',
        'c.name as category_name',
        'c.icon as category_icon',
        'c.color as category_color',
        'a.name as account_name',
        'p.name as payee_name',
        'p.image_url as payee_image_url'
      )
      .orderByRaw(dateHelpers.absDateDistance(knex, 't.date', date).toString() + ' ASC')
      .limit(20);

    return transactions.map(Transaction.format);
  }

  /**
   * Find transactions for reconciliation matching
   */
  static async findForReconciliation(userId, accountId, criteria) {
    const { date, amount, dateTolerance = 2, amountTolerance = 0.01 } = criteria;

    const minAmount = Math.abs(amount) * (1 - amountTolerance);
    const maxAmount = Math.abs(amount) * (1 + amountTolerance);

    const transactions = await knex('transactions as t')
      .leftJoin('categories as c', 't.category_id', 'c.id')
      .where('t.user_id', userId)
      .andWhere('t.account_id', accountId)
      .andWhere('t.status', '!=', 'reconciled')
      .andWhereRaw(dateHelpers.dateTolerance(knex, 't.date', date, dateTolerance).toString())
      .andWhereRaw('ABS(t.amount) BETWEEN ? AND ?', [minAmount, maxAmount])
      .select('t.*', 'c.name as category_name')
      .orderByRaw(`ABS(ABS(t.amount) - ?) ASC`, [Math.abs(amount)])
      .orderByRaw(dateHelpers.absDateDistance(knex, 't.date', date).toString() + ' ASC')
      .limit(10);

    return transactions.map(Transaction.format);
  }

  /**
   * Create a transaction with splits
   */
  static async createWithSplits(userId, data, splits) {
    const tx = await Transaction.create(userId, { ...data, isSplit: true });

    for (const split of splits) {
      await knex('transaction_splits').insert({
        id: generateId(),
        transaction_id: tx.id,
        category_id: split.categoryId,
        amount: split.amount,
        description: split.description || null,
      });
    }

    return Transaction.findById(tx.id, userId);
  }

  /**
   * Get splits for a transaction
   */
  static async getSplits(transactionId, userId) {
    await Transaction.findByIdOrFail(transactionId, userId);

    const splits = await knex('transaction_splits as ts')
      .leftJoin('categories as c', 'ts.category_id', 'c.id')
      .where('ts.transaction_id', transactionId)
      .select('ts.*', 'c.name as category_name');

    return splits.map(s => ({
      id: s.id,
      transactionId: s.transaction_id,
      categoryId: s.category_id,
      categoryName: s.category_name,
      amount: s.amount,
      description: s.description,
    }));
  }

  /**
   * Format a transaction for the API
   */
  static format(tx) {
    return {
      id: tx.id,
      userId: tx.user_id,
      accountId: tx.account_id,
      accountName: tx.account_name,
      categoryId: tx.category_id,
      categoryName: tx.category_name,
      categoryIcon: tx.category_icon,
      categoryColor: tx.category_color,
      payeeId: tx.payee_id,
      payeeName: tx.payee_name,
      payeeImageUrl: tx.payee_image_url,
      creditCardId: tx.credit_card_id,
      creditCardCycleId: tx.credit_card_cycle_id,
      installmentGroupId: tx.installment_group_id,
      installmentNumber: tx.installment_number != null ? Number(tx.installment_number) : null,
      installmentCount: tx.installment_count != null ? Number(tx.installment_count) : null,
      amount: Number(tx.amount),
      description: tx.description,
      notes: tx.notes,
      date: tx.date,
      valueDate: tx.value_date,
      purchaseDate: tx.purchase_date,
      accountingDate: tx.accounting_date,
      status: tx.status,
      type: tx.type,
      isRecurring: Boolean(tx.is_recurring),
      recurringId: tx.recurring_id,
      importId: tx.import_id,
      importHash: tx.import_hash,
      externalId: tx.external_id,
      isReconciled: Boolean(tx.is_reconciled),
      reconciledAt: tx.reconciled_at,
      isSplit: Boolean(tx.is_split),
      parentTransactionId: tx.parent_transaction_id,
      linkedTransactionId: tx.linked_transaction_id,
      sourceType: tx.source_type || null,
      sourceId: tx.source_id || null,
      linkedAccountId: tx.linked_account_id,
      linkedAccountName: tx.linked_account_name,
      hasAttachments: Boolean(tx.has_attachments),
      checkNumber: tx.check_number || null,
      tags: tx.tags ? JSON.parse(tx.tags) : [],
      createdAt: tx.created_at,
      updatedAt: tx.updated_at,
    };
  }
}

export default Transaction;
