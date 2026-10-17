import { test, expect } from '@playwright/test'
import { loginAsSuperAdmin, createUserViaAdmin, loginViaApi, getCsrfToken } from './helpers/auth.js'

const BASE = 'http://localhost:3000'
// The workspace UI has no translations yet, so its labels are the Portuguese defaults in every locale
const PERSONAL_LABEL = 'Meu espaço'

/**
 * Create a fresh regular user through the admin API and log in as them.
 * Avoids public registration, which other specs toggle off and on.
 * @param {import('@playwright/test').Page} page
 */
async function newUser(page, prefix = 'e2e-ws') {
  const { csrfToken } = await loginAsSuperAdmin(page)
  const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.com`
  const { status, password } = await createUserViaAdmin(page, csrfToken, { email, locale: 'pt', currency: 'BRL' })
  expect(status).toBe(201)
  await page.request.post(`${BASE}/api/v1/auth/logout`, { headers: { 'X-CSRF-Token': await getCsrfToken(page) } })
  await loginViaApi(page, email, password)
  const me = await page.request.get(`${BASE}/api/v1/auth/me`)
  expect((await me.json()).data.user.email).toBe(email)
}

/**
 * Create a client workspace via API. The server also makes it the session's active workspace.
 * @param {import('@playwright/test').Page} page
 * @param {object} data
 */
async function createWorkspaceViaApi(page, data) {
  const csrfToken = await getCsrfToken(page)
  const res = await page.request.post(`${BASE}/api/v1/workspaces`, {
    data,
    headers: { 'X-CSRF-Token': csrfToken },
  })
  expect(res.status()).toBe(201)
  return (await res.json()).data.workspace
}

async function listWorkspaces(page) {
  const res = await page.request.get(`${BASE}/api/v1/workspaces`)
  expect(res.status()).toBe(200)
  return (await res.json()).data
}

async function createAccountViaApi(page, workspaceId, name) {
  const csrfToken = await getCsrfToken(page)
  const res = await page.request.post(`${BASE}/api/v1/accounts`, {
    data: { name, type: 'checking', initialBalance: 100 },
    headers: { 'X-CSRF-Token': csrfToken, 'X-Workspace-ID': workspaceId },
  })
  expect(res.status()).toBe(201)
  return (await res.json()).data.account
}

async function accountNames(page, workspaceId) {
  const res = await page.request.get(`${BASE}/api/v1/accounts`, {
    headers: { 'X-Workspace-ID': workspaceId },
  })
  expect(res.status()).toBe(200)
  const body = await res.json()
  const accounts = Array.isArray(body.data) ? body.data : body.data.accounts
  return accounts.map((account) => account.name)
}

async function personalWorkspace(page) {
  const { workspaces } = await listWorkspaces(page)
  return workspaces.find((workspace) => workspace.isPersonal)
}

test.describe('Workspaces – create', () => {
  test.beforeEach(async ({ page }) => {
    await newUser(page)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('should start every user in their personal workspace', async ({ page }) => {
    const switcher = page.locator('#active-workspace')
    await expect(switcher).toBeVisible()
    await expect(switcher.locator('option:checked')).toHaveText(PERSONAL_LABEL)

    const { workspaces, activeWorkspace } = await listWorkspaces(page)
    expect(workspaces).toHaveLength(1)
    expect(activeWorkspace.isPersonal).toBe(true)
  })

  test('should create a client workspace from the header and switch to it', async ({ page }) => {
    const name = `Cliente E2E ${Date.now()}`

    await page.getByRole('button', { name: 'Adicionar cliente' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('#client-name').fill(name)
    await dialog.locator('#new-client-notes').fill('Prazo de entrega: dia 10')
    await dialog.locator('button[type="submit"]').click()

    await expect(dialog).toBeHidden()
    await expect(page.locator('#active-workspace option:checked')).toHaveText(name)

    const { workspaces, activeWorkspace } = await listWorkspaces(page)
    expect(workspaces).toHaveLength(2)
    expect(activeWorkspace.name).toBe(name)
    expect(activeWorkspace.isPersonal).toBe(false)
    expect(activeWorkspace.role).toBe('owner')
    expect(activeWorkspace.notes).toBe('Prazo de entrega: dia 10')
    // Brazilian defaults apply when the form is left untouched
    expect(activeWorkspace.locale).toBe('pt')
    expect(activeWorkspace.currency).toBe('BRL')
  })

  test('should reject a workspace without a name', async ({ page }) => {
    const csrfToken = await getCsrfToken(page)
    const res = await page.request.post(`${BASE}/api/v1/workspaces`, {
      data: { name: '   ' },
      headers: { 'X-CSRF-Token': csrfToken },
    })
    expect(res.status()).toBe(422)

    const { workspaces } = await listWorkspaces(page)
    expect(workspaces).toHaveLength(1)
  })
})

test.describe('Workspaces – switching', () => {
  test.beforeEach(async ({ page }) => {
    await newUser(page)
  })

  test('should switch between workspaces and keep the choice after reload', async ({ page }) => {
    const client = await createWorkspaceViaApi(page, { name: `Switch Client ${Date.now()}` })
    const personal = await personalWorkspace(page)

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const switcher = page.locator('#active-workspace')
    await expect(switcher).toHaveValue(client.id)

    await switcher.selectOption({ label: PERSONAL_LABEL })
    await expect(switcher).toHaveValue(personal.id)
    await expect(switcher).toBeEnabled()

    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(switcher).toHaveValue(personal.id)

    await switcher.selectOption(client.id)
    await expect(switcher).toHaveValue(client.id)
    await expect(switcher).toBeEnabled()
    expect((await listWorkspaces(page)).activeWorkspace.id).toBe(client.id)
  })

  test('should hide a deactivated workspace from the switcher and fall back to personal', async ({ page }) => {
    const name = `Archived Client ${Date.now()}`
    const client = await createWorkspaceViaApi(page, { name })
    const personal = await personalWorkspace(page)

    const csrfToken = await getCsrfToken(page)
    const res = await page.request.post(`${BASE}/api/v1/workspaces/${client.id}/deactivate`, {
      headers: { 'X-CSRF-Token': csrfToken },
    })
    expect(res.status()).toBe(200)

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    const switcher = page.locator('#active-workspace')
    await expect(switcher).toHaveValue(personal.id)
    await expect(switcher.locator('option', { hasText: name })).toHaveCount(0)

    // An inactive workspace cannot be activated or used as request context
    const activateRes = await page.request.post(`${BASE}/api/v1/workspaces/${client.id}/activate`, {
      headers: { 'X-CSRF-Token': await getCsrfToken(page) },
    })
    expect(activateRes.status()).toBe(403)
    const accountsRes = await page.request.get(`${BASE}/api/v1/accounts`, {
      headers: { 'X-Workspace-ID': client.id },
    })
    expect(accountsRes.status()).toBe(403)
  })
})

test.describe('Workspaces – data isolation', () => {
  test('should show only the active workspace accounts on the accounts page', async ({ page }) => {
    await newUser(page)
    const stamp = Date.now()
    const personal = await personalWorkspace(page)
    const clientA = await createWorkspaceViaApi(page, { name: `Client A ${stamp}` })
    const clientB = await createWorkspaceViaApi(page, { name: `Client B ${stamp}` })

    await createAccountViaApi(page, personal.id, `Personal Checking ${stamp}`)
    await createAccountViaApi(page, clientA.id, `Client A Savings ${stamp}`)
    await createAccountViaApi(page, clientB.id, `Client B Wallet ${stamp}`)

    // API: each workspace only sees its own account
    expect(await accountNames(page, personal.id)).toEqual([`Personal Checking ${stamp}`])
    expect(await accountNames(page, clientA.id)).toEqual([`Client A Savings ${stamp}`])
    expect(await accountNames(page, clientB.id)).toEqual([`Client B Wallet ${stamp}`])

    // UI: switching the header selector swaps the visible accounts
    await page.goto('/accounts')
    await page.waitForLoadState('networkidle')
    const main = page.locator('#main-content')
    const switcher = page.locator('#active-workspace')
    await expect(switcher).toHaveValue(clientB.id)

    const expectOnly = async (visible, hidden) => {
      await expect(main.getByText(visible)).toBeVisible()
      for (const name of hidden) {
        await expect(main.getByText(name)).toHaveCount(0)
      }
    }

    await expectOnly(`Client B Wallet ${stamp}`, [`Client A Savings ${stamp}`, `Personal Checking ${stamp}`])

    await switcher.selectOption(clientA.id)
    await expectOnly(`Client A Savings ${stamp}`, [`Client B Wallet ${stamp}`, `Personal Checking ${stamp}`])

    await switcher.selectOption({ label: PERSONAL_LABEL })
    await expectOnly(`Personal Checking ${stamp}`, [`Client A Savings ${stamp}`, `Client B Wallet ${stamp}`])
  })

  test('should not let one workspace modify another workspace account', async ({ page }) => {
    await newUser(page)
    const personal = await personalWorkspace(page)
    const client = await createWorkspaceViaApi(page, { name: `Owner Client ${Date.now()}` })
    const account = await createAccountViaApi(page, client.id, 'Client Only Account')

    const csrfToken = await getCsrfToken(page)
    const getRes = await page.request.get(`${BASE}/api/v1/accounts/${account.id}`, {
      headers: { 'X-Workspace-ID': personal.id },
    })
    expect(getRes.status()).toBe(404)

    const updateRes = await page.request.put(`${BASE}/api/v1/accounts/${account.id}`, {
      data: { name: 'Hijacked' },
      headers: { 'X-CSRF-Token': csrfToken, 'X-Workspace-ID': personal.id },
    })
    expect(updateRes.status()).toBe(404)
    expect(await accountNames(page, client.id)).toEqual(['Client Only Account'])
  })

  test('should not let another user reach a workspace they are not a member of', async ({ page, browser }) => {
    await newUser(page)
    const client = await createWorkspaceViaApi(page, { name: `Private Client ${Date.now()}` })
    await createAccountViaApi(page, client.id, 'Private Account')

    const otherContext = await browser.newContext({ baseURL: BASE })
    const other = await otherContext.newPage()
    try {
      await newUser(other, 'e2e-other')
      const csrfToken = await getCsrfToken(other)

      const { workspaces } = await listWorkspaces(other)
      expect(workspaces.map((workspace) => workspace.id)).not.toContain(client.id)

      const accountsRes = await other.request.get(`${BASE}/api/v1/accounts`, {
        headers: { 'X-Workspace-ID': client.id },
      })
      expect(accountsRes.status()).toBe(403)

      const activateRes = await other.request.post(`${BASE}/api/v1/workspaces/${client.id}/activate`, {
        headers: { 'X-CSRF-Token': csrfToken },
      })
      expect(activateRes.status()).toBe(403)

      const notesRes = await other.request.put(`${BASE}/api/v1/workspaces/${client.id}/notes`, {
        data: { notes: 'Not mine' },
        headers: { 'X-CSRF-Token': csrfToken },
      })
      expect(notesRes.status()).toBe(403)

      const deleteRes = await other.request.delete(`${BASE}/api/v1/workspaces/${client.id}`, {
        headers: { 'X-CSRF-Token': csrfToken },
      })
      expect(deleteRes.status()).toBe(403)
    } finally {
      await otherContext.close()
    }

    expect(await accountNames(page, client.id)).toEqual(['Private Account'])
  })
})

test.describe('Workspaces – notes', () => {
  test('should save notes for one workspace without touching the others', async ({ page }) => {
    await newUser(page)
    const stamp = Date.now()
    const first = await createWorkspaceViaApi(page, { name: `Notes A ${stamp}`, notes: 'Original A' })
    const second = await createWorkspaceViaApi(page, { name: `Notes B ${stamp}`, notes: 'Original B' })

    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Gerir clientes' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    const firstNotes = dialog.locator(`#client-notes-${first.id}`)
    await expect(firstNotes).toHaveValue('Original A')
    await expect(dialog.locator(`#client-notes-${second.id}`)).toHaveValue('Original B')

    await firstNotes.fill('Ligar para o contador na sexta')
    const saveRes = page.waitForResponse((res) =>
      res.url().endsWith(`/api/v1/workspaces/${first.id}/notes`) && res.request().method() === 'PUT')
    await firstNotes.locator('xpath=..').getByRole('button').click()
    expect((await saveRes).status()).toBe(200)

    const { workspaces } = await listWorkspaces(page)
    const byId = Object.fromEntries(workspaces.map((workspace) => [workspace.id, workspace]))
    expect(byId[first.id].notes).toBe('Ligar para o contador na sexta')
    expect(byId[second.id].notes).toBe('Original B')
  })
})
