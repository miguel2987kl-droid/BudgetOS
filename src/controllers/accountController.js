import Account from '../models/Account.js';
import FinanceParameters from '../models/FinanceParameters.js';
import knex from '../database/connection.js';
import { recordChange } from '../services/auditService.js';

export const createAccount = async (req, res) => {
  const account = await Account.create(req.user.id, req.body);
  res.status(201).json({ success: true, data: { account } });
};

export const getAccounts = async (req, res) => {
  const { staleBalanceDays } = await FinanceParameters.get(req.workspace.id);
  const result = await Account.findByUser(req.user.id, { ...req.query, staleBalanceDays });
  res.json({ success: true, data: result.data, totals: result.totals });
};

export const getAccount = async (req, res) => {
  const account = await Account.findByIdOrFail(req.params.id, req.user.id);
  res.json({ success: true, data: { account } });
};

export const updateAccount = async (req, res) => {
  const account = await Account.update(req.params.id, req.user.id, req.body);
  res.json({ success: true, data: { account } });
};

export const deleteAccount = async (req, res) => {
  const result = await Account.delete(req.params.id, req.user.id);
  res.json({ success: true, ...result });
};

export const deactivateAccount = async (req, res) => {
  const result = await Account.deactivate(req.params.id, req.user.id);
  res.json({ success: true, ...result });
};

export const reactivateAccount = async (req, res) => {
  const result = await Account.reactivate(req.params.id, req.user.id);
  res.json({ success: true, ...result });
};

export const getAccountStats = async (req, res) => {
  const stats = await Account.getStats(req.params.id, req.user.id, req.query.period);
  res.json({ success: true, data: { stats } });
};

export const recalculateBalances = async (req, res) => {
  await Account.recalculateAllBalances(req.user.id);
  res.json({ success: true, message: 'Balances recalculated' });
};

export const updateBalances = async (req, res) => {
  const accountIds = req.body.items.map((item) => item.accountId);
  const before = await knex('accounts').whereIn('id', accountIds).where('user_id', req.user.id);
  const results = await Account.updateBalances(req.user.id, req.body);
  const after = await knex('accounts').whereIn('id', accountIds).where('user_id', req.user.id);

  // One audit event per account, so each account's history shows the update.
  res.locals.auditRecorded = true;
  for (const row of after) {
    recordChange({
      workspaceId: req.workspace.id,
      actorUserId: req.actorUser.id,
      entity: 'conta',
      entityId: row.id,
      action: 'atualizar_saldo',
      before: before.find((item) => item.id === row.id) || null,
      after: row,
    });
  }
  res.json({ success: true, data: { results } });
};
