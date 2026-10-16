import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closeTestDb,
  createAuthenticatedAgent,
  createAuthenticatedSuperAdmin,
  createTestApp,
  getTestDb,
  resetTestDb,
  seedSystemSettings,
} from './helpers.js';

let app;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  await seedSystemSettings();
});

const csrfOf = async (agent) => (await agent.get('/api/v1/csrf-token')).body.csrfToken;

/** Audit rows are written after the response; wait for them. */
const waitForAudit = async (where, count = 1) => {
  const db = getTestDb();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const rows = await db('audit_events').where(where).orderBy('created_at', 'asc');
    if (rows.length >= count) return rows;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`audit events not written: ${JSON.stringify(where)}`);
};

const setupClient = async () => {
  const owner = await createAuthenticatedAgent(app, { email: 'dono@bpo.example' });
  const ownerCsrf = await csrfOf(owner.agent);
  const created = await owner.agent
    .post('/api/v1/workspaces')
    .set('X-CSRF-Token', ownerCsrf)
    .send({ name: 'Clínica A', locale: 'pt', currency: 'BRL' });
  return { owner, ownerCsrf, workspace: created.body.data.workspace };
};

const linkMember = async ({ owner, ownerCsrf, workspace }, email, role) => {
  const member = await createAuthenticatedAgent(app, { email });
  const response = await owner.agent
    .post(`/api/v1/workspaces/${workspace.id}/members`)
    .set('X-CSRF-Token', ownerCsrf)
    .send({ email, role });
  expect(response.status).toBe(201);
  return { ...member, csrf: await csrfOf(member.agent) };
};

describe('PAINEL R1 — access by module role', () => {
  it('maps the owner to Administrador and returns the permissions with the workspace', async () => {
    const { owner, workspace } = await setupClient();
    expect(workspace.finance.actor).toBe('admin');
    expect(workspace.finance.permissions['financeiro.contas']).toContain('excluir');

    const context = await owner.agent.get('/api/v1/finance/context').set('X-Workspace-ID', workspace.id);
    expect(context.status).toBe(200);
    expect(context.body.data.parameters).toMatchObject({ staleBalanceDays: 7, taxRate: 0 });
  });

  it('lets an operator work but not delete, and keeps a client out of accounts', async () => {
    const setup = await setupClient();
    const operator = await linkMember(setup, 'operador@bpo.example', 'collaborator');
    const client = await linkMember(setup, 'ana@clinica.example', 'client');
    const { workspace } = setup;

    const created = await operator.agent
      .post('/api/v1/accounts')
      .set('X-Workspace-ID', workspace.id)
      .set('X-CSRF-Token', operator.csrf)
      .send({ name: 'Itaú PJ', type: 'checking', holderType: 'pj', overdraftLimit: 5000 });
    expect(created.status).toBe(201);
    const accountId = created.body.data.account.id;

    const operatorDelete = await operator.agent
      .delete(`/api/v1/accounts/${accountId}`)
      .set('X-Workspace-ID', workspace.id)
      .set('X-CSRF-Token', operator.csrf);
    expect(operatorDelete.status).toBe(403);
    expect(operatorDelete.body.error.code).toBe('FINANCE_PERMISSION_DENIED');

    const clientAccounts = await client.agent.get('/api/v1/accounts').set('X-Workspace-ID', workspace.id);
    expect(clientAccounts.status).toBe(403);
    const clientDashboard = await client.agent.get('/api/v1/reports/dashboard').set('X-Workspace-ID', workspace.id);
    expect(clientDashboard.status).toBe(200);
  });

  it('denies a client access to a company they are not linked to', async () => {
    const setup = await setupClient();
    const client = await linkMember(setup, 'ana@clinica.example', 'client');
    const otherOwner = await createAuthenticatedAgent(app, { email: 'outro@bpo.example' });
    const other = await otherOwner.agent
      .post('/api/v1/workspaces')
      .set('X-CSRF-Token', await csrfOf(otherOwner.agent))
      .send({ name: 'Clínica B' });

    const response = await client.agent.get('/api/v1/reports/dashboard').set('X-Workspace-ID', other.body.data.workspace.id);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('WORKSPACE_FORBIDDEN');
  });

  it('blocks a role that the super admin left unmapped (RF-IN-02)', async () => {
    const setup = await setupClient();
    const client = await linkMember(setup, 'ana@clinica.example', 'client');
    const admin = await createAuthenticatedSuperAdmin(app);
    const mapResponse = await admin.agent
      .put('/api/v1/admin/finance/roles')
      .set('X-CSRF-Token', await csrfOf(admin.agent))
      .send({ client: null });
    expect(mapResponse.status).toBe(200);
    expect(mapResponse.body.data.roleMap).toEqual({ owner: 'admin', collaborator: 'operator', client: null });

    const context = await client.agent.get('/api/v1/finance/context').set('X-Workspace-ID', setup.workspace.id);
    expect(context.body.data.actor).toBeNull();
    const dashboard = await client.agent.get('/api/v1/reports/dashboard').set('X-Workspace-ID', setup.workspace.id);
    expect(dashboard.status).toBe(403);
    expect(dashboard.body.error.code).toBe('FINANCE_ROLE_UNMAPPED');
  });

  it('applies permission overrides from the super admin (RF-IN-07)', async () => {
    const setup = await setupClient();
    const client = await linkMember(setup, 'ana@clinica.example', 'client');
    const admin = await createAuthenticatedSuperAdmin(app);
    const adminCsrf = await csrfOf(admin.agent);

    const access = await admin.agent.get('/api/v1/admin/finance/access');
    expect(access.body.data.catalog.map((entry) => entry.key)).toContain('financeiro.contas');
    const matrix = access.body.data.matrix;
    matrix.client['financeiro.contas'] = ['ver'];
    const saved = await admin.agent.put('/api/v1/admin/finance/permissions').set('X-CSRF-Token', adminCsrf).send({ matrix });
    expect(saved.status).toBe(200);

    expect((await client.agent.get('/api/v1/accounts').set('X-Workspace-ID', setup.workspace.id)).status).toBe(200);

    await admin.agent.post('/api/v1/admin/finance/permissions/reset').set('X-CSRF-Token', adminCsrf);
    expect((await client.agent.get('/api/v1/accounts').set('X-Workspace-ID', setup.workspace.id)).status).toBe(403);
  });

  it('manages members and keeps at least one owner', async () => {
    const setup = await setupClient();
    const { owner, ownerCsrf, workspace } = setup;
    const operator = await linkMember(setup, 'operador@bpo.example', 'collaborator');

    const duplicate = await owner.agent
      .post(`/api/v1/workspaces/${workspace.id}/members`)
      .set('X-CSRF-Token', ownerCsrf)
      .send({ email: 'operador@bpo.example', role: 'client' });
    expect(duplicate.status).toBe(409);

    const unknown = await owner.agent
      .post(`/api/v1/workspaces/${workspace.id}/members`)
      .set('X-CSRF-Token', ownerCsrf)
      .send({ email: 'ninguem@example.com', role: 'client' });
    expect(unknown.status).toBe(404);

    const lastOwner = await owner.agent
      .put(`/api/v1/workspaces/${workspace.id}/members/${owner.user.id}`)
      .set('X-CSRF-Token', ownerCsrf)
      .send({ role: 'client' });
    expect(lastOwner.status).toBe(400);
    expect(lastOwner.body.error.code).toBe('LAST_OWNER');

    const notOwner = await operator.agent
      .get(`/api/v1/workspaces/${workspace.id}/members`);
    expect(notOwner.status).toBe(403);

    const removed = await owner.agent
      .delete(`/api/v1/workspaces/${workspace.id}/members/${operator.user.id}`)
      .set('X-CSRF-Token', ownerCsrf);
    expect(removed.status).toBe(200);
    expect(removed.body.data.members).toHaveLength(1);
    expect((await operator.agent.get('/api/v1/accounts').set('X-Workspace-ID', workspace.id)).status).toBe(403);
  });
});

describe('PAINEL R1 — defaults, audit and accounts', () => {
  it('creates the protected "Recorrências" category and financial parameters (RF-IN-09)', async () => {
    const { owner, ownerCsrf, workspace } = await setupClient();
    const categories = (await owner.agent.get('/api/v1/categories?flat=true').set('X-Workspace-ID', workspace.id)).body.data.categories;
    const recurring = categories.find((category) => category.name === 'Recorrências');
    expect(recurring).toMatchObject({ type: 'expense', isProtected: true });

    const deletion = await owner.agent
      .delete(`/api/v1/categories/${recurring.id}`)
      .set('X-Workspace-ID', workspace.id)
      .set('X-CSRF-Token', ownerCsrf);
    expect(deletion.status).toBe(400);
    expect(deletion.body.error.code).toBe('CATEGORY_PROTECTED');

    const parameters = await owner.agent
      .put('/api/v1/finance/parameters')
      .set('X-Workspace-ID', workspace.id)
      .set('X-CSRF-Token', ownerCsrf)
      .send({ taxRate: 6, staleBalanceDays: 3 });
    expect(parameters.body.data.parameters).toMatchObject({ taxRate: 6, staleBalanceDays: 3 });
  });

  it('records every change with author, before and after (RF-IN-16)', async () => {
    const { owner, ownerCsrf, workspace } = await setupClient();
    const created = await owner.agent
      .post('/api/v1/accounts')
      .set('X-Workspace-ID', workspace.id)
      .set('X-CSRF-Token', ownerCsrf)
      .send({ name: 'Itaú', type: 'checking' });
    const accountId = created.body.data.account.id;
    await owner.agent
      .put(`/api/v1/accounts/${accountId}`)
      .set('X-Workspace-ID', workspace.id)
      .set('X-CSRF-Token', ownerCsrf)
      .send({ name: 'Itaú PJ' });

    const rows = await waitForAudit({ workspace_id: workspace.id, entity: 'conta', entity_id: accountId }, 2);
    expect(rows.map((row) => row.action)).toEqual(['create', 'update']);
    expect(rows[0].actor_user_id).toBe(owner.user.id);
    expect(JSON.parse(rows[1].before_data).name).toBe('Itaú');
    expect(JSON.parse(rows[1].after_data).name).toBe('Itaú PJ');

    const history = await owner.agent
      .get(`/api/v1/finance/audit?entity=conta&entityId=${accountId}`)
      .set('X-Workspace-ID', workspace.id);
    expect(history.body.data.events).toHaveLength(2);
    expect(history.body.data.events[0].actor.email).toBe('dono@bpo.example');
  });

  it('updates balances in batch through adjustment movements, outside income and expenses', async () => {
    const { owner, ownerCsrf, workspace } = await setupClient();
    const headers = { 'X-Workspace-ID': workspace.id, 'X-CSRF-Token': ownerCsrf };
    const first = await owner.agent.post('/api/v1/accounts').set(headers)
      .send({ name: 'Itaú', type: 'checking', initialBalance: 1000, overdraftLimit: 2000, balanceDate: '2026-01-01' });
    const second = await owner.agent.post('/api/v1/accounts').set(headers)
      .send({ name: 'Caixa', type: 'cash', initialBalance: 50 });

    let list = (await owner.agent.get('/api/v1/accounts').set(headers)).body.data;
    const itau = list.find((account) => account.name === 'Itaú');
    expect(itau).toMatchObject({ overdraftLimit: 2000, availableWithOverdraft: 3000, isBalanceStale: true });
    expect(list.find((account) => account.name === 'Caixa').isBalanceStale).toBe(false);

    const today = new Date().toISOString().slice(0, 10);
    const batch = await owner.agent.post('/api/v1/accounts/balances').set(headers).send({
      date: today,
      items: [
        { accountId: first.body.data.account.id, balance: 1250.5 },
        { accountId: second.body.data.account.id, balance: 50 },
      ],
    });
    expect(batch.status).toBe(200);
    expect(batch.body.data.results[0]).toMatchObject({ previousBalance: 1000, newBalance: 1250.5, difference: 250.5 });
    expect(batch.body.data.results[1]).toMatchObject({ difference: 0, adjustmentId: null });

    list = (await owner.agent.get('/api/v1/accounts').set(headers)).body.data;
    expect(list.find((account) => account.name === 'Itaú')).toMatchObject({ currentBalance: 1250.5, balanceDate: today, isBalanceStale: false });

    const db = getTestDb();
    const adjustment = await db('transactions').where('id', batch.body.data.results[0].adjustmentId).first();
    expect(adjustment.type).toBe('adjustment');
    const balanceEvents = await waitForAudit({ entity: 'conta', entity_id: first.body.data.account.id, action: 'atualizar_saldo' });
    expect(Number(JSON.parse(balanceEvents[0].before_data).current_balance)).toBe(1000);
    expect(Number(JSON.parse(balanceEvents[0].after_data).current_balance)).toBe(1250.5);
    const { trend } = (await owner.agent.get('/api/v1/reports/trend/monthly?months=1').set(headers)).body.data;
    expect(trend).toHaveLength(1);
    expect(trend[0]).toMatchObject({ income: 0, expenses: 0 });
  });

  it('lets the operator update balances but denies a client', async () => {
    const setup = await setupClient();
    const client = await linkMember(setup, 'ana@clinica.example', 'client');
    const response = await client.agent
      .post('/api/v1/accounts/balances')
      .set('X-Workspace-ID', setup.workspace.id)
      .set('X-CSRF-Token', client.csrf)
      .send({ date: '2026-10-01', items: [{ accountId: '00000000-0000-4000-8000-000000000000', balance: 1 }] });
    expect(response.status).toBe(403);
  });
});
