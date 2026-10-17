import knex from '../database/connection.js';

const format = (row) => ({
  taxRate: Number(row.tax_rate),
  incomeTaxRate: Number(row.income_tax_rate),
  staleBalanceDays: Number(row.stale_balance_days),
  defaultPeriod: row.default_period,
});

/** Financial parameters of a workspace (RF-IN-09). Created on demand for older workspaces. */
export default class FinanceParameters {
  static async get(workspaceId) {
    let row = await knex('finance_parameters').where('workspace_id', workspaceId).first();
    if (!row) {
      try {
        await knex('finance_parameters').insert({ workspace_id: workspaceId });
      } catch {
        // Created by a concurrent request.
      }
      row = await knex('finance_parameters').where('workspace_id', workspaceId).first();
    }
    return format(row);
  }

  static async update(workspaceId, data) {
    await FinanceParameters.get(workspaceId);
    const updates = {};
    if (data.taxRate !== undefined) updates.tax_rate = data.taxRate;
    if (data.incomeTaxRate !== undefined) updates.income_tax_rate = data.incomeTaxRate;
    if (data.staleBalanceDays !== undefined) updates.stale_balance_days = data.staleBalanceDays;
    if (data.defaultPeriod !== undefined) updates.default_period = data.defaultPeriod;
    if (Object.keys(updates).length > 0) {
      await knex('finance_parameters').where('workspace_id', workspaceId).update({ ...updates, updated_at: knex.fn.now() });
    }
    return FinanceParameters.get(workspaceId);
  }
}
