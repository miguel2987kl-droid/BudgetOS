import { randomUUID } from 'node:crypto';

/**
 * PAINEL R1 foundation: audit trail, financial parameters per workspace,
 * archived workspaces (RN-16), protected categories and the E1 account fields.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.alterTable('client_workspaces', (table) => {
    table.timestamp('archived_at');
    table.string('archived_by', 36);
  });

  await knex.schema.alterTable('categories', (table) => {
    table.boolean('is_protected').notNullable().defaultTo(false);
  });

  await knex.schema.alterTable('accounts', (table) => {
    table.string('holder_type', 2);
    table.decimal('overdraft_limit', 15, 2).notNullable().defaultTo(0);
    table.date('balance_date');
  });

  await knex.schema.createTable('finance_parameters', (table) => {
    table.string('workspace_id', 36).primary()
      .references('id').inTable('client_workspaces').onDelete('CASCADE');
    table.decimal('tax_rate', 7, 4).notNullable().defaultTo(0);
    table.decimal('income_tax_rate', 7, 4).notNullable().defaultTo(0);
    table.integer('stale_balance_days').notNullable().defaultTo(7);
    table.string('default_period', 10).notNullable().defaultTo('month');
    table.timestamps(true, true);
  });

  // No FK on workspace_id: the trail must outlive a purged workspace.
  await knex.schema.createTable('audit_events', (table) => {
    table.string('id', 36).primary();
    table.string('workspace_id', 36);
    table.string('actor_user_id', 36);
    table.string('event', 50).notNullable().defaultTo('registro.alterado');
    table.string('entity', 50).notNullable();
    table.string('entity_id', 36);
    table.string('action', 30).notNullable();
    table.text('before_data');
    table.text('after_data');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['workspace_id', 'entity', 'entity_id']);
    table.index(['workspace_id', 'created_at']);
  });

  const workspaces = await knex('client_workspaces').select('id', 'data_user_id');
  for (const workspace of workspaces) {
    await knex('finance_parameters').insert({ workspace_id: workspace.id });
    const hasRecurring = await knex('categories')
      .where({ user_id: workspace.data_user_id, name: 'Recorrências', type: 'expense' })
      .first();
    if (hasRecurring) {
      await knex('categories').where('id', hasRecurring.id).update({ is_protected: true });
    } else {
      await knex('categories').insert({
        id: randomUUID(), user_id: workspace.data_user_id, name: 'Recorrências', type: 'expense',
        icon: 'Repeat', color: '#0EA5E9', sort_order: 100, is_protected: true,
      });
    }
  }
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  await knex.schema.dropTableIfExists('audit_events');
  await knex.schema.dropTableIfExists('finance_parameters');
  await knex.schema.alterTable('accounts', (table) => {
    table.dropColumn('holder_type');
    table.dropColumn('overdraft_limit');
    table.dropColumn('balance_date');
  });
  await knex.schema.alterTable('categories', (table) => {
    table.dropColumn('is_protected');
  });
  await knex.schema.alterTable('client_workspaces', (table) => {
    table.dropColumn('archived_at');
    table.dropColumn('archived_by');
  });
}
