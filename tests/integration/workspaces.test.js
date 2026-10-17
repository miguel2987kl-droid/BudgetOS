import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import {
  closeTestDb,
  createAuthenticatedAgent,
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

describe('Client workspaces', () => {
  it('keeps client finance data isolated while preserving the signed-in user', async () => {
    const { agent, user } = await createAuthenticatedAgent(app);
    const listResponse = await agent.get('/api/v1/workspaces');
    expect(listResponse.status).toBe(200);
    const personal = listResponse.body.data.activeWorkspace;
    expect(personal.isPersonal).toBe(true);
    const csrfToken = (await agent.get('/api/v1/csrf-token')).body.csrfToken

    const createResponse = await agent
      .post('/api/v1/workspaces')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Cliente Alfa', locale: 'pt', currency: 'BRL' });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.workspace.currency).toBe('BRL');
    expect(createResponse.body.data.workspace.locale).toBe('pt');
    const client = createResponse.body.data.workspace;
    const database = getTestDb();
    const clientRecord = await database('client_workspaces').where('id', client.id).first();

    expect(clientRecord.data_user_id).not.toBe(user.id);
    expect(clientRecord.digit_grouping).toBe('.');
    const internalUser = await database('users').where('id', clientRecord.data_user_id).first();
    expect(internalUser.is_workspace_identity).toBeTruthy();

    const accountResponse = await agent
      .post('/api/v1/accounts')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Conta operacional', type: 'checking', currency: 'BRL' });
    expect(accountResponse.status).toBe(201);

    const clientAccounts = await agent.get('/api/v1/accounts');
    expect(clientAccounts.body.data).toHaveLength(1);

    const personalActivation = await agent
      .post(`/api/v1/workspaces/${personal.id}/activate`)
      .set('X-CSRF-Token', csrfToken);
    expect(personalActivation.status).toBe(200);
    const personalAccounts = await agent.get('/api/v1/accounts');
    expect(personalAccounts.body.data).toHaveLength(0);

    const profileResponse = await agent.get('/api/v1/auth/me');
    expect(profileResponse.body.data.user.id).toBe(user.id);
  });

  it('does not allow another user to activate a client workspace', async () => {
    const owner = await createAuthenticatedAgent(app, { email: 'owner@example.com' });
    const csrf = (await owner.agent.get('/api/v1/csrf-token')).body.csrfToken;
    const createResponse = await owner.agent
      .post('/api/v1/workspaces')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Cliente Restrito', locale: 'pt', currency: 'BRL' });
    const workspaceId = createResponse.body.data.workspace.id;
    const database = getTestDb();
    const clientRecord = await database('client_workspaces').where('id', workspaceId).first();
    const internalUser = await database('users').where('id', clientRecord.data_user_id).first();

    const otherUser = await createAuthenticatedAgent(app, { email: 'other@example.com' });
    const otherCsrf = (await otherUser.agent.get('/api/v1/csrf-token')).body.csrfToken;
    const response = await otherUser.agent
      .post(`/api/v1/workspaces/${workspaceId}/activate`)
      .set('X-CSRF-Token', otherCsrf);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('WORKSPACE_FORBIDDEN');

    const forgedContext = await otherUser.agent
      .get('/api/v1/accounts')
      .set('X-Workspace-ID', workspaceId);
    expect(forgedContext.status).toBe(403);
    expect(forgedContext.body.error.code).toBe('WORKSPACE_FORBIDDEN');

    const anonymous = supertest.agent(app);
    const anonymousCsrf = (await anonymous.get('/api/v1/csrf-token')).body.csrfToken;
    const fakeLogin = await anonymous
      .post('/api/v1/auth/login')
      .set('X-CSRF-Token', anonymousCsrf)
      .send({ email: internalUser.email, password: 'anything' });
    expect(fakeLogin.status).toBe(401);
  });

  it('keeps an inactive client read-only and archives a deleted client before purging it', async () => {
    const { agent } = await createAuthenticatedAgent(app);
    const csrfToken = (await agent.get('/api/v1/csrf-token')).body.csrfToken;
    const createResponse = await agent
      .post('/api/v1/workspaces')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Cliente para gestão', locale: 'pt', currency: 'BRL' });
    const client = createResponse.body.data.workspace;
    const database = getTestDb();
    const clientRecord = await database('client_workspaces').where('id', client.id).first();

    const accountResponse = await agent
      .post('/api/v1/accounts')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Conta do cliente', type: 'checking', currency: 'BRL' });
    expect(accountResponse.status).toBe(201);

    const deactivateResponse = await agent
      .post(`/api/v1/workspaces/${client.id}/deactivate`)
      .set('X-CSRF-Token', csrfToken);
    expect(deactivateResponse.status).toBe(200);
    expect(deactivateResponse.body.data.workspace.isActive).toBe(false);
    const listedClient = (await agent.get('/api/v1/workspaces')).body.data.workspaces
      .find((workspace) => workspace.id === client.id);
    expect(listedClient.isActive).toBe(false);

    // RF-IN-08: an inactive client can still be opened and read, but not changed.
    const activation = await agent
      .post(`/api/v1/workspaces/${client.id}/activate`)
      .set('X-CSRF-Token', csrfToken);
    expect(activation.status).toBe(200);
    expect((await agent.get('/api/v1/accounts')).body.data).toHaveLength(1);
    const blockedWrite = await agent
      .post('/api/v1/accounts')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Nova conta', type: 'checking', currency: 'BRL' });
    expect(blockedWrite.status).toBe(403);
    expect(blockedWrite.body.error.code).toBe('WORKSPACE_INACTIVE');

    const reactivateResponse = await agent
      .post(`/api/v1/workspaces/${client.id}/reactivate`)
      .set('X-CSRF-Token', csrfToken);
    expect(reactivateResponse.status).toBe(200);
    expect(reactivateResponse.body.data.workspace.isActive).toBe(true);

    // RN-16: deleting archives the client and keeps its data until the retention window ends.
    const deleteResponse = await agent
      .delete(`/api/v1/workspaces/${client.id}`)
      .set('X-CSRF-Token', csrfToken);
    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.data.retentionDays).toBe(90);
    const workspaceIds = (await agent.get('/api/v1/workspaces')).body.data.workspaces.map((workspace) => workspace.id);
    expect(workspaceIds).not.toContain(client.id);
    const archived = (await agent.get('/api/v1/workspaces/archived')).body.data.workspaces;
    expect(archived.map((workspace) => workspace.id)).toContain(client.id);
    expect(await database('accounts').where('user_id', clientRecord.data_user_id)).toHaveLength(1);
    const forbiddenAfterArchive = await agent.get('/api/v1/accounts').set('X-Workspace-ID', client.id);
    expect(forbiddenAfterArchive.status).toBe(403);

    const restoreResponse = await agent
      .post(`/api/v1/workspaces/${client.id}/restore`)
      .set('X-CSRF-Token', csrfToken);
    expect(restoreResponse.status).toBe(200);
    expect(restoreResponse.body.data.workspace.isActive).toBe(true);

    await agent.delete(`/api/v1/workspaces/${client.id}`).set('X-CSRF-Token', csrfToken);
    const { default: ClientWorkspace } = await import('../../src/models/ClientWorkspace.js');
    expect(await ClientWorkspace.purgeExpired(90)).toBe(0);
    const later = new Date(Date.now() + 91 * 24 * 60 * 60 * 1000);
    expect(await ClientWorkspace.purgeExpired(90, later)).toBe(1);
    expect(await database('client_workspaces').where('id', client.id).first()).toBeUndefined();
    expect(await database('users').where('id', clientRecord.data_user_id).first()).toBeUndefined();
    expect(await database('accounts').where('user_id', clientRecord.data_user_id)).toHaveLength(0);
  });

  it('stores client notes and restricts editing to workspace owners', async () => {
    const owner = await createAuthenticatedAgent(app, { email: 'notes-owner@example.com' });
    const ownerCsrf = (await owner.agent.get('/api/v1/csrf-token')).body.csrfToken;
    const created = await owner.agent
      .post('/api/v1/workspaces')
      .set('X-CSRF-Token', ownerCsrf)
      .send({ name: 'Cliente com notas', locale: 'pt', currency: 'BRL', notes: 'Contrato mensal; fechamento dia 5.' });
    const clientId = created.body.data.workspace.id;
    expect(created.body.data.workspace.notes).toBe('Contrato mensal; fechamento dia 5.');

    const updated = await owner.agent
      .put(`/api/v1/workspaces/${clientId}/notes`)
      .set('X-CSRF-Token', ownerCsrf)
      .send({ notes: 'Enviar documentos fiscais até dia 3.' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.workspace.notes).toBe('Enviar documentos fiscais até dia 3.');

    const other = await createAuthenticatedAgent(app, { email: 'notes-other@example.com' });
    const otherCsrf = (await other.agent.get('/api/v1/csrf-token')).body.csrfToken;
    const forbidden = await other.agent
      .put(`/api/v1/workspaces/${clientId}/notes`)
      .set('X-CSRF-Token', otherCsrf)
      .send({ notes: 'Alteração não autorizada' });
    expect(forbidden.status).toBe(403);
  });
});
