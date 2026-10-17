/**
 * PAINEL R2: financial operations. Each source record (invoice payment, card
 * sale, bank entry, recurrence, revenue) owns the account movements it
 * generates through transactions.source_type / source_id.
 * @param {import('knex').Knex} knex
 */
export async function up(knex) {
  await knex.schema.alterTable('transactions', (table) => {
    table.string('source_type', 40);
    table.string('source_id', 36);
    table.index(['source_type', 'source_id']);
  });

  await knex.schema.createTable('credit_card_payments', (table) => {
    table.string('id', 36).primary();
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('credit_card_cycle_id', 36).notNullable()
      .references('id').inTable('credit_card_cycles').onDelete('CASCADE');
    table.string('account_id', 36).references('id').inTable('accounts').onDelete('SET NULL');
    table.decimal('amount', 15, 2).notNullable();
    table.date('date').notNullable();
    table.string('created_by', 36);
    table.timestamps(true, true);
    table.index('credit_card_cycle_id');
  });

  await knex.schema.createTable('card_sales', (table) => {
    table.string('id', 36).primary();
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('customer');
    table.string('kind', 10).notNullable().defaultTo('credit');
    table.string('brand', 40);
    table.string('acquirer', 60);
    table.decimal('gross_amount', 15, 2).notNullable();
    table.decimal('fee_rate', 7, 4).notNullable().defaultTo(0);
    table.decimal('fee_amount', 15, 2).notNullable().defaultTo(0);
    table.decimal('discount', 15, 2).notNullable().defaultTo(0);
    table.date('sale_date').notNullable();
    table.integer('installment_count').notNullable().defaultTo(1);
    table.integer('credit_days').notNullable().defaultTo(30);
    table.string('account_id', 36).references('id').inTable('accounts').onDelete('SET NULL');
    table.string('category_id', 36).references('id').inTable('categories').onDelete('SET NULL');
    table.string('document', 60);
    table.text('notes');
    table.string('status', 15).notNullable().defaultTo('active');
    table.timestamps(true, true);
    table.index(['user_id', 'sale_date']);
  });

  await knex.schema.createTable('card_sale_installments', (table) => {
    table.string('id', 36).primary();
    table.string('sale_id', 36).notNullable().references('id').inTable('card_sales').onDelete('CASCADE');
    table.integer('number').notNullable();
    table.date('expected_date').notNullable();
    table.decimal('amount', 15, 2).notNullable();
    table.boolean('credited').notNullable().defaultTo(false);
    table.date('credited_date');
    table.decimal('credited_amount', 15, 2);
    table.string('account_id', 36).references('id').inTable('accounts').onDelete('SET NULL');
    table.index('sale_id');
  });

  await knex.schema.createTable('bank_entries', (table) => {
    table.string('id', 36).primary();
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('account_id', 36).notNullable().references('id').inTable('accounts').onDelete('CASCADE');
    table.string('origin_account_id', 36).references('id').inTable('accounts').onDelete('SET NULL');
    table.text('description').notNullable();
    table.string('payer');
    table.string('document', 60);
    table.decimal('amount', 15, 2).notNullable();
    table.date('date').notNullable();
    table.string('method', 30);
    table.string('category_id', 36).references('id').inTable('categories').onDelete('SET NULL');
    table.timestamps(true, true);
    table.index(['user_id', 'date']);
  });

  await knex.schema.createTable('recurrences', (table) => {
    table.string('id', 36).primary();
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('name').notNullable();
    table.string('creditor');
    table.string('category_id', 36).references('id').inTable('categories').onDelete('SET NULL');
    table.string('method', 30);
    table.decimal('amount', 15, 2).notNullable();
    table.date('first_due_date').notNullable();
    table.integer('total_installments');
    table.string('default_account_id', 36).references('id').inTable('accounts').onDelete('SET NULL');
    table.date('ended_at');
    table.text('notes');
    table.timestamps(true, true);
    table.index('user_id');
  });

  await knex.schema.createTable('recurrence_installments', (table) => {
    table.string('id', 36).primary();
    table.string('recurrence_id', 36).notNullable().references('id').inTable('recurrences').onDelete('CASCADE');
    table.integer('number').notNullable();
    table.date('due_date').notNullable();
    table.decimal('amount', 15, 2).notNullable();
    table.boolean('paid').notNullable().defaultTo(false);
    table.decimal('paid_amount', 15, 2);
    table.date('paid_date');
    table.string('account_id', 36).references('id').inTable('accounts').onDelete('SET NULL');
    table.boolean('outside_accounts').notNullable().defaultTo(false);
    table.boolean('paid_before_system').notNullable().defaultTo(false);
    table.unique(['recurrence_id', 'number']);
    table.index('due_date');
  });

  await knex.schema.createTable('revenues', (table) => {
    table.string('id', 36).primary();
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('kind', 15).notNullable();
    table.text('description').notNullable();
    table.string('customer');
    table.string('document', 60);
    table.string('category_id', 36).references('id').inTable('categories').onDelete('SET NULL');
    table.decimal('gross_amount', 15, 2).notNullable();
    table.decimal('discount', 15, 2).notNullable().defaultTo(0);
    table.decimal('fee', 15, 2).notNullable().defaultTo(0);
    table.date('issue_date').notNullable();
    table.string('status', 15).notNullable().defaultTo('active');
    table.timestamps(true, true);
    table.index(['user_id', 'issue_date']);
  });

  await knex.schema.createTable('revenue_installments', (table) => {
    table.string('id', 36).primary();
    table.string('revenue_id', 36).notNullable().references('id').inTable('revenues').onDelete('CASCADE');
    table.integer('number').notNullable();
    table.date('due_date').notNullable();
    table.decimal('amount', 15, 2).notNullable();
    table.boolean('received').notNullable().defaultTo(false);
    table.decimal('received_amount', 15, 2);
    table.date('received_date');
    table.string('account_id', 36).references('id').inTable('accounts').onDelete('SET NULL');
    table.index('revenue_id');
  });
}

/**
 * @param {import('knex').Knex} knex
 */
export async function down(knex) {
  for (const table of [
    'revenue_installments', 'revenues', 'recurrence_installments', 'recurrences',
    'bank_entries', 'card_sale_installments', 'card_sales', 'credit_card_payments',
  ]) {
    await knex.schema.dropTableIfExists(table);
  }
  await knex.schema.alterTable('transactions', (table) => {
    table.dropIndex(['source_type', 'source_id']);
    table.dropColumn('source_type');
    table.dropColumn('source_id');
  });
}
