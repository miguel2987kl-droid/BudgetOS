import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closeTestDb,
  createAuthenticatedAgent,
  createTestApp,
  getTestDb,
  resetTestDb,
  seedSystemSettings,
} from './helpers.js';

let app;
let agent;
let csrf;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  await seedSystemSettings();
  const ctx = await createAuthenticatedAgent(app);
  agent = ctx.agent;
  csrf = ctx.csrfToken;
});

const post = (url, body) => agent.post(`/api/v1${url}`).set('X-CSRF-Token', csrf).send(body);
const put = (url, body) => agent.put(`/api/v1${url}`).set('X-CSRF-Token', csrf).send(body);
const del = (url) => agent.delete(`/api/v1${url}`).set('X-CSRF-Token', csrf);
const get = (url) => agent.get(`/api/v1${url}`);

const createAccount = async (name, initialBalance = 0, type = 'checking') => {
  const response = await post('/accounts', { name, type, initialBalance });
  expect(response.status).toBe(201);
  return response.body.data.account.id;
};

const balanceOf = async (accountId) => (await get(`/accounts/${accountId}`)).body.data.account.currentBalance;

describe('PAINEL R2 — card invoices (E2)', () => {
  const setupCard = async () => {
    const itau = await createAccount('Itaú', 100000);
    const cardAccount = await createAccount('Cartão Visa', 0, 'credit_card');
    const card = await post('/credit-cards', {
      accountId: cardAccount, name: 'Visa', expirationDate: '12/30', debitType: 'deferred', cycleStartDay: 1, debitDay: 10, creditLimit: 80000,
    });
    expect(card.status).toBe(201);
    const cardId = card.body.data.creditCard.id;
    for (const [amount, date] of [[30000, '2026-10-05'], [20000, '2026-10-20']]) {
      const purchase = await post('/transactions', {
        accountId: cardAccount, creditCardId: cardId, type: 'expense', amount, date, description: 'Compra',
      });
      expect(purchase.status).toBe(201);
    }
    const invoices = await get(`/invoices?cardId=${cardId}&competence=2026-10`);
    expect(invoices.status).toBe(200);
    return { itau, cardAccount, cardId, invoice: invoices.body.data.invoices[0] };
  };

  it('pays the invoice once and never as an expense (RN-04)', async () => {
    const { itau, cardAccount, invoice } = await setupCard();
    expect(invoice).toMatchObject({ total: 50000, paid: 0, pending: 50000, competence: '2026-10', dueDate: '2026-11-10' });

    const tooMuch = await post(`/invoices/${invoice.id}/payments`, { accountId: itau, amount: 50000.01, date: '2026-11-10' });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.code).toBe('AMOUNT_EXCEEDS_PENDING');

    const paid = await post(`/invoices/${invoice.id}/payments`, { accountId: itau, amount: 50000, date: '2026-11-10' });
    expect(paid.status).toBe(201);
    expect(paid.body.data.invoice).toMatchObject({ total: 50000, paid: 50000, pending: 0, status: 'paga' });

    expect(await balanceOf(itau)).toBe(50000);
    expect(await balanceOf(cardAccount)).toBe(0);

    const db = getTestDb();
    const expenses = await db('transactions').where({ type: 'expense' }).sum({ total: 'amount' }).first();
    expect(Number(expenses.total)).toBe(-50000);

    // The movement belongs to the payment: it cannot be edited from the transactions list.
    const movement = await db('transactions').where({ source_type: 'credit_card_payment', account_id: itau }).first();
    const directDelete = await del(`/transactions/${movement.id}`);
    expect(directDelete.status).toBe(400);
    expect(directDelete.body.error.code).toBe('TRANSACTION_HAS_SOURCE');

    const undone = await del(`/invoices/payments/${paid.body.data.id}`);
    expect(undone.status).toBe(200);
    expect(undone.body.data.invoice.pending).toBe(50000);
    expect(await balanceOf(itau)).toBe(100000);
  });

  it('counts refunds against the invoice and shows the cards summary', async () => {
    const { cardAccount, cardId } = await setupCard();
    const refund = await post('/transactions', {
      accountId: cardAccount, creditCardId: cardId, type: 'income', amount: 5000, date: '2026-10-22', description: 'Estorno',
    });
    expect(refund.status).toBe(201);
    const [invoice] = (await get(`/invoices?cardId=${cardId}&competence=2026-10`)).body.data.invoices;
    expect(invoice.total).toBe(45000);

    const summary = await get('/invoices/summary');
    expect(summary.status).toBe(200);
    expect(summary.body.data.cards[0]).toMatchObject({ limit: 80000, used: 45000, available: 35000 });
  });
});

describe('PAINEL R2 — card sales (E3)', () => {
  it('credits the first of five installments without a second revenue (acceptance scenario)', async () => {
    const itau = await createAccount('Itaú', 0);
    const created = await post('/card-sales', {
      customer: 'Paciente', brand: 'Visa', grossAmount: 100000, feeRate: 3, installmentCount: 5, saleDate: '2026-10-01', creditDays: 30, accountId: itau,
    });
    expect(created.status).toBe(201);
    const sale = created.body.data.sale;
    expect(sale).toMatchObject({ grossAmount: 100000, feeAmount: 3000, netAmount: 97000, receivable: 97000 });
    expect(sale.installments.map((item) => item.amount)).toEqual([19400, 19400, 19400, 19400, 19400]);
    expect(sale.installments[0].expectedDate).toBe('2026-10-31');

    const credited = await post(`/card-sales/installments/${sale.installments[0].id}/credit`, { date: '2026-10-31' });
    expect(credited.status).toBe(200);
    expect(credited.body.data.sale).toMatchObject({ received: 19400, receivable: 77600 });
    expect(await balanceOf(itau)).toBe(19400);

    const db = getTestDb();
    const incomes = await db('transactions').where({ type: 'income' }).count({ count: '*' }).first();
    expect(Number(incomes.count)).toBe(0);

    const consolidated = await get('/revenues/consolidated?from=2026-10-01&to=2026-10-31');
    expect(consolidated.body.data.totals.gross).toBe(100000);

    const undone = await del(`/card-sales/installments/${sale.installments[0].id}/credit`);
    expect(undone.body.data.sale.receivable).toBe(97000);
    expect(await balanceOf(itau)).toBe(0);
  });

  it('blocks value changes once an installment is credited', async () => {
    const itau = await createAccount('Itaú', 0);
    const created = await post('/card-sales', {
      grossAmount: 1000, kind: 'debit', saleDate: '2026-10-01', accountId: itau, creditNow: true,
    });
    expect(created.body.data.sale.receivable).toBe(0);
    const change = await put(`/card-sales/${created.body.data.sale.id}`, { grossAmount: 2000 });
    expect(change.status).toBe(400);
    expect(change.body.error.code).toBe('SALE_HAS_CREDITS');
    const removed = await del(`/card-sales/${created.body.data.sale.id}`);
    expect(removed.status).toBe(200);
    expect(await balanceOf(itau)).toBe(0);
  });
});

describe('PAINEL R2 — bank entries (E4)', () => {
  it('warns about duplicates and keeps transfers out of revenue (RN-05)', async () => {
    const itau = await createAccount('Itaú', 0);
    const bradesco = await createAccount('Bradesco', 5000);
    const entry = { accountId: itau, description: 'PIX cliente', payer: 'Cliente', amount: 1500, date: '2026-10-10' };
    expect((await post('/bank-entries', entry)).status).toBe(201);

    const duplicate = await post('/bank-entries', entry);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('POSSIBLE_DUPLICATE');
    expect(duplicate.body.error.details.duplicates).toHaveLength(1);
    expect((await post('/bank-entries', { ...entry, confirmDuplicate: true })).status).toBe(201);

    const transfer = await post('/bank-entries', {
      accountId: itau, originAccountId: bradesco, description: 'Transferência', amount: 2000, date: '2026-10-11',
    });
    expect(transfer.status).toBe(201);
    expect(await balanceOf(itau)).toBe(5000);
    expect(await balanceOf(bradesco)).toBe(3000);

    const list = await get('/bank-entries?from=2026-10-01&to=2026-10-31');
    expect(list.body.data.totals).toEqual({ entries: 3000, transfers: 2000 });
    const consolidated = await get('/revenues/consolidated?from=2026-10-01&to=2026-10-31');
    expect(consolidated.body.data.totals.gross).toBe(3000);

    const edited = await put(`/bank-entries/${transfer.body.data.entry.id}`, { amount: 2500 });
    expect(edited.status).toBe(200);
    expect(await balanceOf(itau)).toBe(5500);
    expect(await balanceOf(bradesco)).toBe(2500);
  });
});

describe('PAINEL R2 — recurrences (E5)', () => {
  it('pays outside the accounts without touching balances (acceptance scenario)', async () => {
    const itau = await createAccount('Itaú', 10000);
    const created = await post('/recurrences', {
      name: 'Financiamento do carro', amount: 1250, firstDueDate: '2026-01-15', totalInstallments: 60, paidBeforeSystem: 12,
    });
    expect(created.status).toBe(201);
    const recurrence = created.body.data.recurrence;
    expect(recurrence.installments).toHaveLength(60);
    expect(recurrence.paidCount).toBe(12);
    expect(recurrence.remainingBalance).toBe(60000);

    const thirteenth = recurrence.installments[12];
    const paid = await post(`/recurrences/installments/${thirteenth.id}/pay`, { date: '2027-01-15', outsideAccounts: true });
    expect(paid.status).toBe(200);
    expect(paid.body.data.recurrence.remainingBalance).toBe(58750);
    expect(paid.body.data.recurrence.installments[12]).toMatchObject({ paid: true, paidAmount: 1250, outsideAccounts: true });
    expect(await balanceOf(itau)).toBe(10000);

    const fourteenth = recurrence.installments[13];
    await post(`/recurrences/installments/${fourteenth.id}/pay`, { date: '2027-02-15', accountId: itau });
    expect(await balanceOf(itau)).toBe(8750);
    const undone = await del(`/recurrences/installments/${fourteenth.id}/pay`);
    expect(undone.status).toBe(200);
    expect(await balanceOf(itau)).toBe(10000);

    const bills = await get('/recurrences/month?month=2027-01');
    expect(bills.body.data.bills.some((bill) => bill.id === thirteenth.id && bill.paid)).toBe(true);
    // Installments paid before the system are not bills of any month (RN-11).
    const oldBills = await get('/recurrences/month?month=2026-03');
    expect(oldBills.body.data.bills.some((bill) => bill.number === 3)).toBe(false);
  });

  it('adjusts open installments, ends a series and keeps open-ended ones a year ahead', async () => {
    const created = await post('/recurrences', { name: 'Aluguel', amount: 3000, firstDueDate: '2026-01-05' });
    const recurrence = created.body.data.recurrence;
    expect(recurrence.openEnded).toBe(true);
    expect(recurrence.installments.length).toBeGreaterThanOrEqual(12);

    const adjusted = await post(`/recurrences/${recurrence.id}/adjust`, { amount: 3300, fromNumber: 3 });
    expect(adjusted.body.data.recurrence.installments[1].amount).toBe(3000);
    expect(adjusted.body.data.recurrence.installments[2].amount).toBe(3300);

    const ended = await post(`/recurrences/${recurrence.id}/end`, { endDate: '2026-04-30' });
    expect(ended.body.data.recurrence.endedAt).toBe('2026-04-30');
    expect(ended.body.data.recurrence.installments).toHaveLength(4);
  });
});

describe('PAINEL R2 — revenues (E6)', () => {
  it('receives a boleto with or without an account and cancels keeping history', async () => {
    const itau = await createAccount('Itaú', 0);
    const boleto = await post('/revenues', {
      kind: 'boleto', description: 'Consultoria', customer: 'Empresa X', grossAmount: 3000, issueDate: '2026-01-02',
      installmentCount: 3, firstDueDate: '2026-02-10',
    });
    expect(boleto.status).toBe(201);
    const revenue = boleto.body.data.revenue;
    // Past due and not received: overdue automatically.
    expect(revenue.status).toBe('vencido');

    await post(`/revenues/installments/${revenue.installments[0].id}/receive`, { date: '2026-02-10', amount: 1000, accountId: itau });
    const outside = await post(`/revenues/installments/${revenue.installments[1].id}/receive`, { date: '2026-03-10', amount: 1000 });
    expect(outside.body.data.revenue.received).toBe(2000);
    expect(await balanceOf(itau)).toBe(1000);

    const cancelled = await post(`/revenues/${revenue.id}/cancel`, {});
    expect(cancelled.body.data.revenue.status).toBe('cancelado');
    expect(await balanceOf(itau)).toBe(0);
    expect((await get(`/revenues/${revenue.id}`)).status).toBe(200);
  });

  it('records cash received at once', async () => {
    const caixa = await createAccount('Caixa', 0, 'cash');
    const cash = await post('/revenues', {
      kind: 'cash', description: 'Consulta', grossAmount: 250, issueDate: '2026-10-03', receivedNow: { accountId: caixa },
    });
    expect(cash.body.data.revenue.status).toBe('recebido');
    expect(await balanceOf(caixa)).toBe(250);
  });

  it('records an audit event with the record before and after', async () => {
    const created = await post('/revenues', { kind: 'cash', description: 'Consulta', grossAmount: 100, issueDate: '2030-10-03' });
    await post(`/revenues/${created.body.data.revenue.id}/cancel`, {});
    const events = await getTestDb()('audit_events').where({ entity: 'receita', entity_id: created.body.data.revenue.id }).orderBy('created_at');
    expect(events.map((event) => event.action)).toEqual(['criar', 'cancelar']);
    expect(JSON.parse(events[1].before_data).status).toBe('em_aberto');
    expect(JSON.parse(events[1].after_data).status).toBe('cancelado');
  });
});

describe('PAINEL R2 — permissions by module role', () => {
  it('lets a client see revenues but not change them or open card sales', async () => {
    const owner = await createAuthenticatedAgent(app, { email: 'dono@bpo.example' });
    const ownerCsrf = (await owner.agent.get('/api/v1/csrf-token')).body.csrfToken;
    const workspace = (await owner.agent.post('/api/v1/workspaces').set('X-CSRF-Token', ownerCsrf).send({ name: 'Clínica A' })).body.data.workspace;
    const client = await createAuthenticatedAgent(app, { email: 'ana@clinica.example' });
    const linked = await owner.agent.post(`/api/v1/workspaces/${workspace.id}/members`)
      .set('X-CSRF-Token', ownerCsrf).send({ email: 'ana@clinica.example', role: 'client' });
    expect(linked.status).toBe(201);
    const clientCsrf = (await client.agent.get('/api/v1/csrf-token')).body.csrfToken;

    const list = await client.agent.get('/api/v1/revenues').set('X-Workspace-ID', workspace.id);
    expect(list.status).toBe(200);
    const create = await client.agent.post('/api/v1/revenues').set('X-Workspace-ID', workspace.id).set('X-CSRF-Token', clientCsrf)
      .send({ kind: 'cash', description: 'X', grossAmount: 10, issueDate: '2026-10-01' });
    expect(create.status).toBe(403);
    const sales = await client.agent.get('/api/v1/card-sales').set('X-Workspace-ID', workspace.id);
    expect(sales.status).toBe(403);
  });
});
