/**
 * @fileoverview Unit tests for AdminGroups page component
 * Tests rendering, group CRUD, member panel, and member management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Prevent i18n side-effect initialization via errorHelper
vi.mock('../../src/lib/errorHelper', () => ({
  translateError: (err) => err?.response?.data?.message || err?.message || 'Error',
}))

// Mock AuthContext - defaults to super_admin
const mockAuthValue = {
  user: { id: 'admin1', email: 'admin@test.com', role: 'super_admin' },
  isGroupAdmin: false,
}
vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}))

import AdminGroups from '../../src/pages/AdminGroups'

// Mock the API module
vi.mock('../../src/lib/api', () => ({
  groupsApi: {
    getAll: vi.fn(),
    getOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getMembers: vi.fn(),
    addMember: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
  },
  adminApi: {
    getUsers: vi.fn(),
    getSettings: vi.fn(),
  },
}))

// Mock the Toast component
const mockToast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('../../src/components/Toast', () => ({
  useToast: () => mockToast,
}))

import { groupsApi, adminApi } from '../../src/lib/api'

const mockGroups = [
  {
    id: 'g1',
    name: 'Famille',
    description: 'Groupe familial',
    status: 'active',
    memberCount: 3,
  },
  {
    id: 'g2',
    name: 'Travail',
    description: 'Collegues',
    status: 'active',
    memberCount: 5,
  },
  {
    id: 'g3',
    name: 'Archive',
    description: 'Ancien groupe',
    status: 'inactive',
    memberCount: 0,
  },
]

const mockMembers = [
  { userId: 'u1', email: 'alice@test.com', firstName: 'Alice', lastName: 'Martin', role: 'admin' },
  { userId: 'u2', email: 'bob@test.com', firstName: 'Bob', lastName: 'Dupont', role: 'member' },
]

const mockUsers = [
  { id: 'u1', email: 'alice@test.com', firstName: 'Alice', lastName: 'Martin' },
  { id: 'u2', email: 'bob@test.com', firstName: 'Bob', lastName: 'Dupont' },
  { id: 'u3', email: 'carol@test.com', firstName: 'Carol', lastName: 'Leroy' },
]

/**
 * Creates a fresh QueryClient for test isolation
 */
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
}

/**
 * Renders a component wrapped with QueryClientProvider
 */
function renderWithProviders(ui) {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  )
}

/**
 * Helper: wait for groups to be rendered (data loaded)
 */
async function waitForGroupsLoaded() {
  await waitFor(() => {
    expect(screen.getByText('Famille')).toBeInTheDocument()
  })
}

describe('AdminGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset to super_admin by default
    mockAuthValue.user = { id: 'admin1', email: 'admin@test.com', role: 'super_admin' }
    mockAuthValue.isGroupAdmin = false
    groupsApi.getAll.mockResolvedValue({ data: { data: mockGroups } })
    groupsApi.getMembers.mockResolvedValue({ data: { data: mockMembers } })
    adminApi.getUsers.mockResolvedValue({ data: { data: mockUsers } })
    adminApi.getSettings.mockResolvedValue({ data: { data: { defaultLocale: 'fr' } } })
  })

  describe('rendering', () => {
    it('renders page title and description after loading', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      expect(screen.getByText('admin.groups.title')).toBeInTheDocument()
      expect(screen.getByText('admin.groups.subtitle')).toBeInTheDocument()
    })

    it('renders the new group button after loading', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      expect(screen.getByText('admin.groups.newGroup')).toBeInTheDocument()
    })

    it('renders loading spinner initially', () => {
      groupsApi.getAll.mockReturnValue(new Promise(() => {}))
      renderWithProviders(<AdminGroups />)

      expect(document.querySelector('.animate-spin')).toBeInTheDocument()
    })

    it('renders group cards with names', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      expect(screen.getByText('Travail')).toBeInTheDocument()
      expect(screen.getByText('Archive')).toBeInTheDocument()
    })

    it('renders group descriptions', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      expect(screen.getByText('Groupe familial')).toBeInTheDocument()
      expect(screen.getByText('Collegues')).toBeInTheDocument()
    })

    it('displays member counts', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      // t('admin.groups.memberCount', { count: N }) returns just the key
      const memberCountElements = screen.getAllByText('admin.groups.memberCount')
      expect(memberCountElements.length).toBe(3)
    })

    it('displays status badges', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      const activeBadges = screen.getAllByText('common.active')
      expect(activeBadges.length).toBe(2)
      expect(screen.getByText('common.inactive')).toBeInTheDocument()
    })

    it('shows empty state when no groups', async () => {
      groupsApi.getAll.mockResolvedValue({ data: { data: [] } })
      renderWithProviders(<AdminGroups />)

      await waitFor(() => {
        expect(screen.getByText('admin.groups.noGroups')).toBeInTheDocument()
        expect(screen.getByText('admin.groups.createFirst')).toBeInTheDocument()
      })
    })

    it('renders edit and delete buttons for each group', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      const editButtons = screen.getAllByTitle('common.edit')
      const deleteButtons = screen.getAllByTitle('common.delete')
      expect(editButtons.length).toBe(3)
      expect(deleteButtons.length).toBe(3)
    })

    it('renders "Voir les membres" toggle for each group', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      const toggleButtons = screen.getAllByText('admin.groups.showMembers')
      expect(toggleButtons.length).toBe(3)
    })
  })

  describe('create group modal', () => {
    it('opens modal when clicking new group button', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      fireEvent.click(screen.getByText('admin.groups.newGroup'))

      await waitFor(() => {
        expect(screen.getByText('common.description')).toBeInTheDocument()
      })
    })

    it('closes modal when clicking cancel', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      fireEvent.click(screen.getByText('admin.groups.newGroup'))

      await waitFor(() => {
        expect(screen.getByText('common.description')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('common.cancel'))

      await waitFor(() => {
        expect(screen.queryByText('common.description')).not.toBeInTheDocument()
      })
    })

    it('calls create API on form submit', async () => {
      groupsApi.create.mockResolvedValue({ data: { data: { id: 'new' } } })
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      fireEvent.click(screen.getByText('admin.groups.newGroup'))

      await waitFor(() => {
        expect(screen.getByText('common.description')).toBeInTheDocument()
      })

      // Find inputs in the modal
      const modal = document.querySelector('.fixed.inset-0')
      const nameInput = modal.querySelector('input[type="text"]')
      const descTextarea = modal.querySelector('textarea')

      fireEvent.change(nameInput, { target: { value: 'New Group' } })
      fireEvent.change(descTextarea, { target: { value: 'A new group' } })

      // Submit the form inside the modal
      const form = modal.querySelector('form')
      await act(async () => {
        fireEvent.submit(form)
      })

      // React Query v5 passes extra context arg to mutationFn
      expect(groupsApi.create).toHaveBeenCalled()
      const callArgs = groupsApi.create.mock.calls[0][0]
      expect(callArgs).toMatchObject({
        name: 'New Group',
        description: 'A new group',
        defaultLocale: 'fr',
      })
    })

    it('renders FormLanguageSelect for default locale', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      fireEvent.click(screen.getByText('admin.groups.newGroup'))

      await waitFor(() => {
        expect(screen.getByText('admin.groups.defaultLocale')).toBeInTheDocument()
      })

      // FormLanguageSelect renders a button with aria-haspopup="listbox"
      const modal = document.querySelector('.fixed.inset-0')
      const langTrigger = modal.querySelector('button[aria-haspopup="listbox"]')
      expect(langTrigger).toBeInTheDocument()
      expect(langTrigger).toHaveTextContent('Français')
    })

    it('allows changing locale via FormLanguageSelect in create modal', async () => {
      groupsApi.create.mockResolvedValue({ data: { data: { id: 'new' } } })
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      fireEvent.click(screen.getByText('admin.groups.newGroup'))

      await waitFor(() => {
        expect(screen.getByText('admin.groups.defaultLocale')).toBeInTheDocument()
      })

      const modal = document.querySelector('.fixed.inset-0')

      // Open the language dropdown
      const langTrigger = modal.querySelector('button[aria-haspopup="listbox"]')
      fireEvent.click(langTrigger)

      // Select English
      const englishOption = screen.getByRole('option', { name: /English/ })
      fireEvent.click(englishOption)

      // Fill required fields and submit
      const nameInput = modal.querySelector('input[type="text"]')
      fireEvent.change(nameInput, { target: { value: 'English Group' } })

      await act(async () => {
        fireEvent.submit(modal.querySelector('form'))
      })

      expect(groupsApi.create).toHaveBeenCalled()
      const callArgs = groupsApi.create.mock.calls[0][0]
      expect(callArgs.defaultLocale).toBe('en')
    })
  })

  describe('edit group', () => {
    it('opens edit modal when clicking edit button', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      const editButtons = screen.getAllByTitle('common.edit')
      fireEvent.click(editButtons[0])

      await waitFor(() => {
        expect(screen.getByText('admin.groups.editGroup')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Famille')).toBeInTheDocument()
        expect(screen.getByDisplayValue('Groupe familial')).toBeInTheDocument()
      })
    })

    it('calls update API on edit form submit', async () => {
      groupsApi.update.mockResolvedValue({ data: { data: {} } })
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      const editButtons = screen.getAllByTitle('common.edit')
      fireEvent.click(editButtons[0])

      await waitFor(() => {
        expect(screen.getByDisplayValue('Famille')).toBeInTheDocument()
      })

      const nameInput = screen.getByDisplayValue('Famille')
      fireEvent.change(nameInput, { target: { value: 'Famille Updated' } })

      // Submit the form inside the modal
      const modal = document.querySelector('.fixed.inset-0')
      await act(async () => {
        fireEvent.submit(modal.querySelector('form'))
      })

      // React Query v5: mutationFn receives { id, data } from mutate call
      expect(groupsApi.update).toHaveBeenCalled()
      const updateCallArgs = groupsApi.update.mock.calls[0]
      expect(updateCallArgs[0]).toBe('g1')
      expect(updateCallArgs[1]).toMatchObject({
        name: 'Famille Updated',
        description: 'Groupe familial',
      })
    })
  })

  describe('delete group', () => {
    it('calls delete API when confirming deletion', async () => {
      groupsApi.delete.mockResolvedValue({ data: {} })

      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      // Click the group delete button to open the confirmation modal
      fireEvent.click(screen.getAllByTitle('common.delete')[0])
      // Confirm inside the modal (scoped to avoid the row icon buttons)
      const modal = document.querySelector('.fixed.inset-0')
      await act(async () => {
        fireEvent.click(within(modal).getByRole('button', { name: 'common.delete' }))
      })

      expect(groupsApi.delete).toHaveBeenCalledWith('g1', expect.anything())
    })

    it('does not delete when cancelling confirmation', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false)

      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      const deleteButtons = screen.getAllByTitle('common.delete')
      fireEvent.click(deleteButtons[0])

      expect(groupsApi.delete).not.toHaveBeenCalled()

      window.confirm.mockRestore()
    })
  })

  describe('members panel', () => {
    it('expands to show members when clicking toggle', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      fireEvent.click(screen.getAllByText('admin.groups.showMembers')[0])

      await waitFor(() => {
        expect(screen.getByText('admin.groups.members')).toBeInTheDocument()
      })
    })

    it('shows member names after expanding', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      fireEvent.click(screen.getAllByText('admin.groups.showMembers')[0])

      await waitFor(() => {
        expect(screen.getByText('Alice Martin')).toBeInTheDocument()
        expect(screen.getByText('Bob Dupont')).toBeInTheDocument()
      })
    })

    it('shows member emails', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      fireEvent.click(screen.getAllByText('admin.groups.showMembers')[0])

      await waitFor(() => {
        expect(screen.getByText('alice@test.com')).toBeInTheDocument()
        expect(screen.getByText('bob@test.com')).toBeInTheDocument()
      })
    })

    it('collapses members when clicking toggle again', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      fireEvent.click(screen.getAllByText('admin.groups.showMembers')[0])

      await waitFor(() => {
        expect(screen.getByText('admin.groups.hideMembers')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('admin.groups.hideMembers'))

      await waitFor(() => {
        expect(screen.queryByText('admin.groups.hideMembers')).not.toBeInTheDocument()
      })
    })

    it('shows empty message when group has no members', async () => {
      groupsApi.getMembers.mockResolvedValue({ data: { data: [] } })
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      fireEvent.click(screen.getAllByText('admin.groups.showMembers')[0])

      await waitFor(() => {
        expect(screen.getByText('admin.groups.noMembers')).toBeInTheDocument()
      })
    })

    it('shows delete button for each member', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      // Before expanding: 3 group card delete buttons
      expect(screen.getAllByTitle('common.delete').length).toBe(3)

      fireEvent.click(screen.getAllByText('admin.groups.showMembers')[0])

      await waitFor(() => {
        // After expanding: 2 members each get a dedicated remove button
        expect(screen.getAllByTitle('admin.groups.removeMember').length).toBe(2)
      })
    })

    it('calls removeMember API when confirming deletion', async () => {
      groupsApi.removeMember.mockResolvedValue({ data: {} })

      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      fireEvent.click(screen.getAllByText('admin.groups.showMembers')[0])

      await waitFor(() => {
        expect(screen.getByText('Alice Martin')).toBeInTheDocument()
      })

      // Click Alice's remove button, then confirm inside the modal
      fireEvent.click(screen.getAllByTitle('admin.groups.removeMember')[0])
      const modal = document.querySelector('.fixed.inset-0')
      await act(async () => {
        fireEvent.click(within(modal).getByRole('button', { name: 'admin.groups.removeMember' }))
      })

      await waitFor(() => {
        expect(groupsApi.removeMember).toHaveBeenCalledWith('g1', 'u1')
      })
    })
  })

  describe('add member modal (super_admin)', () => {
    it('opens add member modal with tabs from expanded panel', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      fireEvent.click(screen.getAllByText('admin.groups.showMembers')[0])

      await waitFor(() => {
        expect(screen.getByText('common.add')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('common.add'))

      await waitFor(() => {
        expect(screen.getByText('admin.groups.addMember')).toBeInTheDocument()
        // Super admin sees both tabs
        expect(screen.getByText('admin.groups.existingUser')).toBeInTheDocument()
        expect(screen.getByText('admin.groups.newMember')).toBeInTheDocument()
        // Default tab is existing user
        expect(screen.getByText('admin.users.title')).toBeInTheDocument()
        expect(screen.getByText('admin.groups.groupRole')).toBeInTheDocument()
      })
    })

    it('calls addMember API with existing user on form submit', async () => {
      groupsApi.addMember.mockResolvedValue({ data: { data: {} } })
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      fireEvent.click(screen.getAllByText('admin.groups.showMembers')[0])

      await waitFor(() => {
        expect(screen.getByText('common.add')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('common.add'))

      await waitFor(() => {
        expect(screen.getByText('admin.groups.addMember')).toBeInTheDocument()
      })

      // Select a user (Carol is the only one not already a member)
      const userSelect = screen.getByText('admin.groups.selectUser').closest('select')
      fireEvent.change(userSelect, { target: { value: 'u3' } })

      // Find submit button inside the add member modal
      const modal = document.querySelectorAll('.fixed.inset-0')
      // The add member modal is the last overlay
      const addMemberModal = modal[modal.length - 1]
      const submitBtn = within(addMemberModal).getAllByRole('button').find(b => b.textContent === 'common.add')
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(groupsApi.addMember).toHaveBeenCalledWith('g1', {
          userId: 'u3',
          role: 'member',
        })
      })
    })

    it('calls addMember API with inline creation on new member tab', async () => {
      groupsApi.addMember.mockResolvedValue({ data: { data: {} } })
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      fireEvent.click(screen.getAllByText('admin.groups.showMembers')[0])

      await waitFor(() => {
        expect(screen.getByText('common.add')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('common.add'))

      await waitFor(() => {
        expect(screen.getByText('admin.groups.newMember')).toBeInTheDocument()
      })

      // Switch to new member tab
      fireEvent.click(screen.getByText('admin.groups.newMember'))

      await waitFor(() => {
        expect(screen.getByText('admin.users.form.email')).toBeInTheDocument()
      })

      // Fill in the inline creation form
      const modal = document.querySelectorAll('.fixed.inset-0')
      const addMemberModal = modal[modal.length - 1]
      const emailInput = addMemberModal.querySelector('input[type="email"]')
      const passwordInput = addMemberModal.querySelector('input[type="password"]')
      const textInputs = addMemberModal.querySelectorAll('input[type="text"]')

      fireEvent.change(textInputs[0], { target: { value: 'New' } })
      fireEvent.change(textInputs[1], { target: { value: 'Member' } })
      fireEvent.change(emailInput, { target: { value: 'new@test.com' } })
      fireEvent.change(passwordInput, { target: { value: 'Test1234!' } })

      const form = addMemberModal.querySelector('form')
      await act(async () => {
        fireEvent.submit(form)
      })

      await waitFor(() => {
        expect(groupsApi.addMember).toHaveBeenCalledWith('g1', {
          email: 'new@test.com',
          password: 'Test1234!',
          firstName: 'New',
          lastName: 'Member',
          role: 'member',
          locale: 'pt',
          currency: 'BRL',
        })
      })
    })

    it('renders FormLanguageSelect in new member tab', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      fireEvent.click(screen.getAllByText('admin.groups.showMembers')[0])

      await waitFor(() => {
        expect(screen.getByText('common.add')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('common.add'))

      await waitFor(() => {
        expect(screen.getByText('admin.groups.newMember')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('admin.groups.newMember'))

      await waitFor(() => {
        expect(screen.getByText('admin.users.form.language')).toBeInTheDocument()
      })

      // FormLanguageSelect renders a button with aria-haspopup="listbox"
      const modal = document.querySelectorAll('.fixed.inset-0')
      const addMemberModal = modal[modal.length - 1]
      const langTrigger = addMemberModal.querySelector('button[aria-haspopup="listbox"]')
      expect(langTrigger).toBeInTheDocument()
      expect(langTrigger).toHaveTextContent('Português')
    })

    it('allows changing locale via FormLanguageSelect when adding new member', async () => {
      groupsApi.addMember.mockResolvedValue({ data: { data: {} } })
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      fireEvent.click(screen.getAllByText('admin.groups.showMembers')[0])

      await waitFor(() => {
        expect(screen.getByText('common.add')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('common.add'))

      await waitFor(() => {
        expect(screen.getByText('admin.groups.newMember')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('admin.groups.newMember'))

      await waitFor(() => {
        expect(screen.getByText('admin.users.form.email')).toBeInTheDocument()
      })

      const modal = document.querySelectorAll('.fixed.inset-0')
      const addMemberModal = modal[modal.length - 1]

      // Open language dropdown and select Deutsch
      const langTrigger = addMemberModal.querySelector('button[aria-haspopup="listbox"]')
      fireEvent.click(langTrigger)

      const deutschOption = screen.getByRole('option', { name: /Deutsch/ })
      fireEvent.click(deutschOption)

      // Fill required fields
      const emailInput = addMemberModal.querySelector('input[type="email"]')
      const passwordInput = addMemberModal.querySelector('input[type="password"]')
      fireEvent.change(emailInput, { target: { value: 'german@test.com' } })
      fireEvent.change(passwordInput, { target: { value: 'Test1234!' } })

      const form = addMemberModal.querySelector('form')
      await act(async () => {
        fireEvent.submit(form)
      })

      await waitFor(() => {
        expect(groupsApi.addMember).toHaveBeenCalledWith('g1', expect.objectContaining({
          locale: 'de',
          email: 'german@test.com',
        }))
      })
    })
  })

  describe('group admin access', () => {
    beforeEach(() => {
      mockAuthValue.user = { id: 'manager1', email: 'manager@test.com', role: 'user' }
      mockAuthValue.isGroupAdmin = true
    })

    it('hides new group button for group admin', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      expect(screen.queryByText('admin.groups.newGroup')).not.toBeInTheDocument()
    })

    it('hides edit and delete buttons for group admin', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      expect(screen.queryByTitle('common.edit')).not.toBeInTheDocument()
      expect(screen.queryByTitle('common.delete')).not.toBeInTheDocument()
    })

    it('shows groups and member toggle for group admin', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      expect(screen.getByText('Famille')).toBeInTheDocument()
      expect(screen.getByText('Travail')).toBeInTheDocument()
      const toggleButtons = screen.getAllByText('admin.groups.showMembers')
      expect(toggleButtons.length).toBe(3)
    })

    it('shows only inline creation form (no tabs) in add member modal for group admin', async () => {
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      fireEvent.click(screen.getAllByText('admin.groups.showMembers')[0])

      await waitFor(() => {
        expect(screen.getByText('common.add')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('common.add'))

      await waitFor(() => {
        expect(screen.getByText('admin.groups.addMember')).toBeInTheDocument()
      })

      // No tabs should be shown
      expect(screen.queryByText('admin.groups.existingUser')).not.toBeInTheDocument()
      // Inline creation form visible directly
      expect(screen.getByText('admin.users.form.email')).toBeInTheDocument()
      expect(screen.getByText('admin.users.form.password')).toBeInTheDocument()
      expect(screen.getByText('admin.users.form.firstName')).toBeInTheDocument()
      expect(screen.getByText('admin.users.form.lastName')).toBeInTheDocument()
      expect(screen.getByText('admin.users.form.language')).toBeInTheDocument()
      expect(screen.getByText('admin.users.form.currency')).toBeInTheDocument()
    })

    it('calls addMember API with inline data for group admin', async () => {
      groupsApi.addMember.mockResolvedValue({ data: { data: {} } })
      renderWithProviders(<AdminGroups />)
      await waitForGroupsLoaded()

      fireEvent.click(screen.getAllByText('admin.groups.showMembers')[0])

      await waitFor(() => {
        expect(screen.getByText('common.add')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('common.add'))

      await waitFor(() => {
        expect(screen.getByText('admin.users.form.email')).toBeInTheDocument()
      })

      const modal = document.querySelectorAll('.fixed.inset-0')
      const addMemberModal = modal[modal.length - 1]
      const emailInput = addMemberModal.querySelector('input[type="email"]')
      const passwordInput = addMemberModal.querySelector('input[type="password"]')
      const textInputs = addMemberModal.querySelectorAll('input[type="text"]')

      fireEvent.change(textInputs[0], { target: { value: 'Jean' } })
      fireEvent.change(textInputs[1], { target: { value: 'Dupont' } })
      fireEvent.change(emailInput, { target: { value: 'newuser@test.com' } })
      fireEvent.change(passwordInput, { target: { value: 'Pass1234!' } })

      const form = addMemberModal.querySelector('form')
      await act(async () => {
        fireEvent.submit(form)
      })

      await waitFor(() => {
        expect(groupsApi.addMember).toHaveBeenCalledWith('g1', {
          email: 'newuser@test.com',
          password: 'Pass1234!',
          firstName: 'Jean',
          lastName: 'Dupont',
          role: 'member',
          locale: 'pt',
          currency: 'BRL',
        })
      })
    })
  })
})
