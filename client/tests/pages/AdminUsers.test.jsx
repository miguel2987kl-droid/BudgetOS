/**
 * @fileoverview Unit tests for AdminUsers page component
 * Tests rendering, filtering, user creation modal, edit modal, role changes,
 * suspend/reactivate actions, and group management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// react-i18next is mocked globally in tests/setup.js (t returns the key)

// Mock AuthContext (Modal consumes useAuth for userSettings)
vi.mock('../../src/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', email: 'admin@test.com', role: 'super_admin' },
    userSettings: {},
    isGroupAdmin: false,
  }),
}))

// Prevent i18n side-effect initialization via errorHelper
vi.mock('../../src/lib/errorHelper', () => ({
  translateError: (err) => {
    const data = err?.response?.data?.error || err
    return data?.message || err?.message || 'Error'
  },
}))

// Mock useFormatters to avoid AuthProvider dependency
vi.mock('../../src/hooks/useFormatters', () => ({
  useFormatters: () => ({
    formatCurrency: (amount) => `${amount} €`,
    formatDate: (date) => new Date(date).toLocaleDateString('fr-FR'),
    formatDateRelative: (date) => new Date(date).toLocaleDateString('fr-FR'),
    locale: 'fr',
  }),
}))

import AdminUsers from '../../src/pages/AdminUsers'

// Mock the API module
vi.mock('../../src/lib/api', () => ({
  adminApi: {
    getUsers: vi.fn(),
    getUser: vi.fn(),
    getSettings: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    suspendUser: vi.fn(),
    reactivateUser: vi.fn(),
    deleteUser: vi.fn(),
    updateUserRole: vi.fn(),
  },
  groupsApi: {
    getAll: vi.fn(),
    addMember: vi.fn(),
    removeMember: vi.fn(),
    updateMember: vi.fn(),
  },
}))

// Mock the Toast component
const mockToast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('../../src/components/Toast', () => ({
  useToast: () => mockToast,
}))

import { adminApi, groupsApi } from '../../src/lib/api'

const mockUsers = [
  {
    id: 'u1',
    email: 'admin@test.com',
    firstName: 'Admin',
    lastName: 'User',
    role: 'super_admin',
    status: 'active',
    isActive: true,
    locale: 'fr',
    currency: 'EUR',
    createdAt: '2026-01-15T10:00:00.000Z',
  },
  {
    id: 'u2',
    email: 'john@test.com',
    firstName: 'John',
    lastName: 'Doe',
    role: 'user',
    status: 'active',
    isActive: true,
    locale: 'en',
    currency: 'USD',
    createdAt: '2026-01-20T10:00:00.000Z',
  },
  {
    id: 'u3',
    email: 'suspended@test.com',
    firstName: 'Jane',
    lastName: 'Smith',
    role: 'user',
    status: 'suspended',
    isActive: false,
    locale: 'fr',
    currency: 'EUR',
    createdAt: '2026-01-10T10:00:00.000Z',
  },
]

const mockGroups = [
  { id: 'g1', name: 'Group A' },
  { id: 'g2', name: 'Group B' },
]

const mockUserDetailResponse = {
  data: {
    success: true,
    data: {
      user: { ...mockUsers[1] },
      groups: [
        { id: 'g1', name: 'Group A', role: 'member' },
      ],
    },
  },
}

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
 * Helper: wait for users table to be rendered (data loaded)
 */
async function waitForUsersLoaded() {
  await waitFor(() => {
    expect(screen.getByText('admin@test.com')).toBeInTheDocument()
  })
}

describe('AdminUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminApi.getUsers.mockResolvedValue({ data: { data: mockUsers } })
    adminApi.getUser.mockResolvedValue(mockUserDetailResponse)
    adminApi.getSettings.mockResolvedValue({ data: { data: { defaultLocale: 'fr' } } })
    groupsApi.getAll.mockResolvedValue({ data: { data: mockGroups } })
  })

  describe('rendering', () => {
    it('renders page title and new user button after loading', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      expect(screen.getByText('admin.users.title')).toBeInTheDocument()
      expect(screen.getByText('admin.users.subtitle')).toBeInTheDocument()
      expect(screen.getByText('admin.users.newUser')).toBeInTheDocument()
    })

    it('renders loading spinner initially', () => {
      adminApi.getUsers.mockReturnValue(new Promise(() => {}))
      renderWithProviders(<AdminUsers />)

      expect(document.querySelector('.animate-spin')).toBeInTheDocument()
    })

    it('renders users table with emails', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      expect(screen.getByText('john@test.com')).toBeInTheDocument()
      expect(screen.getByText('suspended@test.com')).toBeInTheDocument()
    })

    it('displays user names in the table', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      expect(screen.getByText('Admin User')).toBeInTheDocument()
      expect(screen.getByText('John Doe')).toBeInTheDocument()
      expect(screen.getByText('Jane Smith')).toBeInTheDocument()
    })

    it('displays role badges in table rows', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      // Look for role badges inside the table body only
      const tableBody = document.querySelector('tbody')
      const superAdminBadge = within(tableBody).getByText('admin.users.roles.super_admin')
      expect(superAdminBadge).toBeInTheDocument()

      const userBadges = within(tableBody).getAllByText('admin.users.roles.user')
      expect(userBadges.length).toBe(2)
    })

    it('displays status badges in table rows', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      const tableBody = document.querySelector('tbody')
      const activeBadges = within(tableBody).getAllByText('admin.users.statuses.active')
      expect(activeBadges.length).toBe(2)
      expect(within(tableBody).getByText('admin.users.statuses.suspended')).toBeInTheDocument()
    })

    it('displays lifecycle actions (suspend for active, permanent delete for inactive)', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      // Active users (u1, u2) can be suspended; the inactive user (u3) can be
      // reactivated or permanently deleted.
      expect(screen.getAllByTitle('admin.users.suspend').length).toBe(2)
      expect(screen.getAllByTitle('admin.users.permanentDelete').length).toBe(1)
    })

    it('displays edit button (icon only) for each user', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      const editButtons = screen.getAllByTitle('common.edit')
      expect(editButtons.length).toBe(3)
    })

    it('shows empty state when no users', async () => {
      adminApi.getUsers.mockResolvedValue({ data: { data: [] } })
      renderWithProviders(<AdminUsers />)

      await waitFor(() => {
        expect(screen.getByText('admin.users.noUsers')).toBeInTheDocument()
      })
    })

    it('renders all column headers', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      const thead = document.querySelector('thead')
      expect(within(thead).getByText('admin.users.tableHeaders.name')).toBeInTheDocument()
      expect(within(thead).getByText('admin.users.tableHeaders.email')).toBeInTheDocument()
      expect(within(thead).getByText('admin.users.tableHeaders.role')).toBeInTheDocument()
      expect(within(thead).getByText('admin.users.tableHeaders.status')).toBeInTheDocument()
      expect(within(thead).getByText('admin.users.tableHeaders.actions')).toBeInTheDocument()
    })
  })

  describe('filters', () => {
    it('renders search input', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      expect(screen.getByPlaceholderText('admin.users.searchPlaceholder')).toBeInTheDocument()
    })

    it('renders role and status filter selects', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      expect(screen.getByDisplayValue('admin.users.allRoles')).toBeInTheDocument()
      expect(screen.getByDisplayValue('admin.users.allStatuses')).toBeInTheDocument()
    })

    it('calls API with search term when searching', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      const searchInput = screen.getByPlaceholderText('admin.users.searchPlaceholder')
      fireEvent.change(searchInput, { target: { value: 'john' } })

      await waitFor(() => {
        expect(adminApi.getUsers).toHaveBeenCalledWith(
          expect.objectContaining({ search: 'john' })
        )
      })
    })

    it('calls API with role filter', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      const roleSelect = screen.getByDisplayValue('admin.users.allRoles')
      fireEvent.change(roleSelect, { target: { value: 'admin' } })

      await waitFor(() => {
        expect(adminApi.getUsers).toHaveBeenCalledWith(
          expect.objectContaining({ role: 'admin' })
        )
      })
    })

    it('calls API with status filter', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      const statusSelect = screen.getByDisplayValue('admin.users.allStatuses')
      fireEvent.change(statusSelect, { target: { value: 'suspended' } })

      await waitFor(() => {
        expect(adminApi.getUsers).toHaveBeenCalledWith(
          expect.objectContaining({ status: 'suspended' })
        )
      })
    })
  })

  describe('create user modal', () => {
    it('opens modal when clicking new user button', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByText('admin.users.newUser'))

      await waitFor(() => {
        expect(screen.getByText('admin.users.form.password')).toBeInTheDocument()
        expect(screen.getByText('admin.users.form.firstName')).toBeInTheDocument()
      })
    })

    it('renders group selector, locale and currency in create modal', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByText('admin.users.newUser'))

      await waitFor(() => {
        expect(screen.getByText('admin.users.form.group')).toBeInTheDocument()
        expect(screen.getByText('admin.users.noGroup')).toBeInTheDocument()
        expect(screen.getByText('admin.users.form.language')).toBeInTheDocument()
        expect(screen.getByText('admin.users.form.currency')).toBeInTheDocument()
      })
    })

    it('closes modal when clicking cancel', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByText('admin.users.newUser'))

      await waitFor(() => {
        expect(screen.getByText('admin.users.form.password')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('common.cancel'))

      await waitFor(() => {
        expect(screen.queryByText('admin.users.form.password')).not.toBeInTheDocument()
      })
    })

    it('shows "Creer" button in create mode', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByText('admin.users.newUser'))

      await waitFor(() => {
        expect(screen.getByText('common.create')).toBeInTheDocument()
      })
    })

    it('calls createUser API on form submit', async () => {
      adminApi.createUser.mockResolvedValue({ data: { data: { id: 'new' } } })
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByText('admin.users.newUser'))

      await waitFor(() => {
        expect(document.querySelector('input[type="email"]')).toBeInTheDocument()
      })

      fireEvent.change(document.querySelector('input[type="email"]'), { target: { value: 'new@test.com' } })
      fireEvent.change(document.querySelector('input[type="password"]'), { target: { value: 'password123' } })

      // Submit the form in the modal
      const modal = document.querySelector('.fixed.inset-0')
      await act(async () => {
        fireEvent.submit(modal.querySelector('form'))
      })

      // React Query v5 passes extra context arg to mutationFn
      expect(adminApi.createUser).toHaveBeenCalled()
      const callArgs = adminApi.createUser.mock.calls[0][0]
      expect(callArgs).toMatchObject({
        email: 'new@test.com',
        password: 'password123',
        role: 'user',
      })
    })
  })

  describe('edit user modal', () => {
    it('opens edit modal when clicking Modifier button', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      const editButtons = screen.getAllByTitle('common.edit')
      fireEvent.click(editButtons[1]) // Click edit on second user (John Doe)

      await waitFor(() => {
        expect(screen.getByText('admin.users.editUser')).toBeInTheDocument()
      })
    })

    it('shows "Enregistrer" button in edit mode', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      const editButtons = screen.getAllByTitle('common.edit')
      fireEvent.click(editButtons[1])

      await waitFor(() => {
        expect(screen.getByText('common.save')).toBeInTheDocument()
      })
    })

    it('does not show password field in edit mode', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      const editButtons = screen.getAllByTitle('common.edit')
      fireEvent.click(editButtons[1])

      await waitFor(() => {
        expect(screen.getByText('admin.users.editUser')).toBeInTheDocument()
      })

      expect(screen.queryByText('admin.users.form.password')).not.toBeInTheDocument()
    })

    it('shows simple group dropdown in edit mode for user role', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      const editButtons = screen.getAllByTitle('common.edit')
      fireEvent.click(editButtons[1])

      await waitFor(() => {
        expect(screen.getByText('admin.users.editUser')).toBeInTheDocument()
      })

      // User role shows "Groupe" (singular) with simple dropdown
      await waitFor(() => {
        expect(screen.getByText('admin.users.form.group')).toBeInTheDocument()
      })
      // Multi-group section "Groupes" (plural) should NOT be shown
      expect(screen.queryByText('admin.users.form.groups')).not.toBeInTheDocument()
    })

    it('shows locale and currency fields in edit mode', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      const editButtons = screen.getAllByTitle('common.edit')
      fireEvent.click(editButtons[1])

      await waitFor(() => {
        expect(screen.getByText('admin.users.form.language')).toBeInTheDocument()
        expect(screen.getByText('admin.users.form.currency')).toBeInTheDocument()
      })
    })

    it('pre-fills form with user data in edit mode', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      const editButtons = screen.getAllByTitle('common.edit')
      fireEvent.click(editButtons[1])

      await waitFor(() => {
        expect(screen.getByText('admin.users.editUser')).toBeInTheDocument()
      })

      // Check email field is pre-filled
      const emailInput = document.querySelector('input[type="email"]')
      expect(emailInput.value).toBe('john@test.com')
    })

    it('shows simple group dropdown with user group in edit mode', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      const editButtons = screen.getAllByTitle('common.edit')
      fireEvent.click(editButtons[1])

      await waitFor(() => {
        expect(screen.getByText('admin.users.form.group')).toBeInTheDocument()
      })

      // Wait for getUser query to resolve and group to be selected
      await waitFor(() => {
        expect(adminApi.getUser).toHaveBeenCalledWith('u2')
      })

      // Group A should be selected in the dropdown
      await waitFor(() => {
        const groupLabel = screen.getByText('admin.users.form.group')
        const groupSelect = groupLabel.closest('div').querySelector('select')
        expect(groupSelect.value).toBe('g1')
      })
    })

    it('displays user groups when loaded', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      const editButtons = screen.getAllByTitle('common.edit')
      fireEvent.click(editButtons[1])

      // Wait for the edit modal to appear
      await waitFor(() => {
        expect(screen.getByText('admin.users.editUser')).toBeInTheDocument()
      })

      // Wait for the getUser query to resolve and groups to render
      await waitFor(() => {
        expect(adminApi.getUser).toHaveBeenCalledWith('u2')
      })

      await waitFor(() => {
        expect(screen.getByText('Group A')).toBeInTheDocument()
      })
    })

    it('calls updateUser API on form submit with changed fields', async () => {
      adminApi.updateUser.mockImplementation((id, data) => {
        return Promise.resolve({ data: { data: { user: { ...mockUsers[1], ...data } } } })
      })
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      // Open edit modal for user u2
      fireEvent.click(screen.getAllByTitle('common.edit')[1])

      // Wait for modal
      await waitFor(() => {
        expect(screen.getByText('admin.users.editUser')).toBeInTheDocument()
      })

      // The UserModal is rendered inside the Modal portal (fixed inset-0)
      // Get the modal overlay and find form within
      const modalOverlay = document.querySelector('.fixed.inset-0.bg-black\\/50')
      const form = modalOverlay.querySelector('form')
      expect(form).not.toBeNull()

      // Change first name input (first text input in the form)
      const firstNameInput = form.querySelectorAll('input[type="text"]')[0]
      fireEvent.change(firstNameInput, { target: { value: 'Johnny' } })

      // Submit the form directly
      fireEvent.submit(form)

      await waitFor(() => {
        expect(adminApi.updateUser).toHaveBeenCalled()
      })

      const [callId, callData] = adminApi.updateUser.mock.calls[0]
      expect(callId).toBe('u2')
      expect(callData).toMatchObject({ firstName: 'Johnny' })
    })

    it('changes group via simple dropdown in edit mode (user role)', async () => {
      adminApi.updateUser.mockResolvedValue({ data: { data: { user: mockUsers[1] } } })
      groupsApi.removeMember.mockResolvedValue({ data: {} })
      groupsApi.addMember.mockResolvedValue({ data: {} })
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      const editButtons = screen.getAllByTitle('common.edit')
      fireEvent.click(editButtons[1])

      await waitFor(() => {
        expect(screen.getByText('admin.users.form.group')).toBeInTheDocument()
      })

      // Wait for getUser query to resolve
      await waitFor(() => {
        expect(adminApi.getUser).toHaveBeenCalledWith('u2')
      })

      // Change from Group A to Group B via dropdown
      const groupLabel = screen.getByText('admin.users.form.group')
      const groupSelect = groupLabel.closest('div').querySelector('select')
      await waitFor(() => {
        expect(groupSelect.value).toBe('g1')
      })

      await act(async () => {
        fireEvent.change(groupSelect, { target: { value: 'g2' } })
      })

      // Submit the form
      const modalOverlay = document.querySelector('.fixed.inset-0.bg-black\\/50')
      const form = modalOverlay.querySelector('form')
      await act(async () => {
        fireEvent.submit(form)
      })

      // Should remove old group and add new group on save
      await waitFor(() => {
        expect(groupsApi.removeMember).toHaveBeenCalledWith('g1', 'u2')
        expect(groupsApi.addMember).toHaveBeenCalledWith('g2', { userId: 'u2', role: 'member' })
      })
    })

    it('calls addMember on save after adding a group in edit mode (admin user)', async () => {
      const adminUser = { ...mockUsers[1], role: 'admin' }
      adminApi.getUser.mockResolvedValue({
        data: {
          success: true,
          data: {
            user: adminUser,
            groups: [{ id: 'g1', name: 'Group A', role: 'member' }],
          },
        },
      })
      adminApi.getUsers.mockResolvedValue({ data: { data: [mockUsers[0], adminUser, mockUsers[2]] } })
      groupsApi.addMember.mockResolvedValue({ data: {} })

      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getAllByTitle('common.edit')[1])

      await waitFor(() => {
        expect(screen.getByText('Group A')).toBeInTheDocument()
      })

      // Click "Ajouter"
      fireEvent.click(screen.getByText('admin.users.addGroup'))
      await waitFor(() => {
        expect(screen.getByText('admin.users.chooseGroup')).toBeInTheDocument()
      })

      // Select Group B
      const groupSelect = screen.getByText('admin.users.chooseGroup').closest('select')
      fireEvent.change(groupSelect, { target: { value: 'g2' } })
      fireEvent.click(screen.getByText('common.ok'))

      // Group B should appear locally
      await waitFor(() => {
        expect(screen.getByText('Group B')).toBeInTheDocument()
      })

      // API not called yet
      expect(groupsApi.addMember).not.toHaveBeenCalled()

      // Submit the form
      const modalOverlay = document.querySelector('.fixed.inset-0.bg-black\\/50')
      const form = modalOverlay.querySelector('form')
      await act(async () => {
        fireEvent.submit(form)
      })

      // Now addMember should be called on save
      await waitFor(() => {
        expect(groupsApi.addMember).toHaveBeenCalledWith('g2', { userId: 'u2', role: 'member' })
      })
    })

    it('calls removeMember on save after removing a group in edit mode (admin user)', async () => {
      const adminUser = { ...mockUsers[1], role: 'admin' }
      adminApi.getUser.mockResolvedValue({
        data: {
          success: true,
          data: {
            user: adminUser,
            groups: [{ id: 'g1', name: 'Group A', role: 'member' }],
          },
        },
      })
      adminApi.getUsers.mockResolvedValue({ data: { data: [mockUsers[0], adminUser, mockUsers[2]] } })
      groupsApi.removeMember.mockResolvedValue({ data: {} })
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      const editButtons = screen.getAllByTitle('common.edit')
      fireEvent.click(editButtons[1])

      await waitFor(() => {
        expect(screen.getByText('admin.users.editUser')).toBeInTheDocument()
      })

      // Wait for groups to render
      await waitFor(() => {
        expect(screen.getByText('Group A')).toBeInTheDocument()
      })

      // Click remove button (locally removes the group)
      const removeBtn = screen.getByTitle('admin.users.removeFromGroup')
      await act(async () => {
        fireEvent.click(removeBtn)
      })

      // Group A should disappear from the list
      expect(screen.queryByText('Group A')).not.toBeInTheDocument()
      // API not called yet
      expect(groupsApi.removeMember).not.toHaveBeenCalled()

      // Submit the form
      const modalOverlay = document.querySelector('.fixed.inset-0.bg-black\\/50')
      const form = modalOverlay.querySelector('form')
      await act(async () => {
        fireEvent.submit(form)
      })

      // Now removeMember should be called on save
      await waitFor(() => {
        expect(groupsApi.removeMember).toHaveBeenCalledWith('g1', 'u2')
      })
    })

    it('calls updateMember on save after changing group role in edit mode (admin user)', async () => {
      const adminUser = { ...mockUsers[1], role: 'admin' }
      adminApi.getUser.mockResolvedValue({
        data: {
          success: true,
          data: {
            user: adminUser,
            groups: [{ id: 'g1', name: 'Group A', role: 'member' }],
          },
        },
      })
      adminApi.getUsers.mockResolvedValue({ data: { data: [mockUsers[0], adminUser, mockUsers[2]] } })
      groupsApi.updateMember.mockResolvedValue({ data: {} })
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      const editButtons = screen.getAllByTitle('common.edit')
      fireEvent.click(editButtons[1])

      await waitFor(() => {
        expect(screen.getByText('admin.users.editUser')).toBeInTheDocument()
      })

      // Wait for groups to render
      await waitFor(() => {
        expect(screen.getByText('Group A')).toBeInTheDocument()
      })

      // Find the role select within the group row and change it
      const groupRow = screen.getByText('Group A').closest('.flex')
      const roleSelect = groupRow.querySelector('select')
      await act(async () => {
        fireEvent.change(roleSelect, { target: { value: 'admin' } })
      })

      // API not called yet
      expect(groupsApi.updateMember).not.toHaveBeenCalled()

      // Submit the form
      const modalOverlay = document.querySelector('.fixed.inset-0.bg-black\\/50')
      const form = modalOverlay.querySelector('form')
      await act(async () => {
        fireEvent.submit(form)
      })

      // Now updateMember should be called on save
      await waitFor(() => {
        expect(groupsApi.updateMember).toHaveBeenCalledWith('g1', 'u2', 'admin')
      })
    })

    it('closes edit modal when clicking Annuler', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      const editButtons = screen.getAllByTitle('common.edit')
      fireEvent.click(editButtons[1])

      await waitFor(() => {
        expect(screen.getByText('admin.users.editUser')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('common.cancel'))

      await waitFor(() => {
        expect(screen.queryByText('admin.users.editUser')).not.toBeInTheDocument()
      })
    })
  })

  describe('delete user', () => {
    it('calls deleteUser API when confirming permanent deletion', async () => {
      adminApi.deleteUser.mockResolvedValue({ data: {} })

      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      // Open the permanent-delete modal for the inactive user (u3)
      fireEvent.click(screen.getByTitle('admin.users.permanentDelete'))
      // Confirm requires typing the user's email
      fireEvent.change(screen.getByPlaceholderText('suspended@test.com'), {
        target: { value: 'suspended@test.com' },
      })

      await act(async () => {
        fireEvent.click(screen.getByText('admin.users.permanentDeleteConfirm').closest('button'))
      })

      expect(adminApi.deleteUser).toHaveBeenCalledWith('u3', expect.anything())
    })

    it('does not call deleteUser when the typed email does not match', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByTitle('admin.users.permanentDelete'))
      // Wrong email keeps the confirm button disabled
      fireEvent.change(screen.getByPlaceholderText('suspended@test.com'), {
        target: { value: 'wrong@test.com' },
      })
      const confirmButton = screen.getByText('admin.users.permanentDeleteConfirm').closest('button')
      expect(confirmButton).toBeDisabled()
      fireEvent.click(confirmButton)

      expect(adminApi.deleteUser).not.toHaveBeenCalled()
    })
  })

  describe('conditional group management - create mode', () => {
    it('shows simple group dropdown for user role', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByText('admin.users.newUser'))

      await waitFor(() => {
        // Default role is user: should show singular "Groupe" dropdown
        expect(screen.getByText('admin.users.form.group')).toBeInTheDocument()
        expect(screen.getByText('admin.users.noGroup')).toBeInTheDocument()
        // Should NOT show multi-group section "Groupes"
        expect(screen.queryByText('admin.users.form.groups')).not.toBeInTheDocument()
      })
    })

    it('shows multi-group section with Ajouter button for admin role', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByText('admin.users.newUser'))

      await waitFor(() => {
        expect(screen.getByText('admin.users.form.group')).toBeInTheDocument()
      })

      // Find the role select inside the modal form (the one with the "Role" label)
      const modalOverlay = document.querySelector('.fixed.inset-0.bg-black\\/50')
      const form = modalOverlay.querySelector('form')
      const roleLabel = within(form).getByText('admin.users.form.role')
      const roleSelectEl = roleLabel.closest('div').querySelector('select')
      fireEvent.change(roleSelectEl, { target: { value: 'admin' } })

      await waitFor(() => {
        // Should now show multi-group section
        expect(screen.getByText('admin.users.form.groups')).toBeInTheDocument()
        expect(screen.getByText('admin.users.addGroup')).toBeInTheDocument()
        // Simple dropdown should be gone
        expect(screen.queryByText('admin.users.form.group')).not.toBeInTheDocument()
      })
    })

    it('hides groups section entirely for super_admin role', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByText('admin.users.newUser'))

      await waitFor(() => {
        expect(screen.getByText('admin.users.form.group')).toBeInTheDocument()
      })

      // Find role select inside the modal form
      const modalOverlay = document.querySelector('.fixed.inset-0.bg-black\\/50')
      const form = modalOverlay.querySelector('form')
      const roleLabel = within(form).getByText('admin.users.form.role')
      const roleSelectEl = roleLabel.closest('div').querySelector('select')
      fireEvent.change(roleSelectEl, { target: { value: 'super_admin' } })

      await waitFor(() => {
        expect(screen.queryByText('admin.users.form.group')).not.toBeInTheDocument()
        expect(screen.queryByText('admin.users.form.groups')).not.toBeInTheDocument()
      })
    })

    it('migrates groupId to pendingGroups when switching user→admin', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByText('admin.users.newUser'))

      await waitFor(() => {
        expect(screen.getByText('admin.users.form.group')).toBeInTheDocument()
      })

      // Select a group in user mode
      const groupSelect = screen.getByText('admin.users.noGroup').closest('select')
      fireEvent.change(groupSelect, { target: { value: 'g1' } })

      // Find role select inside the modal form
      const modalOverlay = document.querySelector('.fixed.inset-0.bg-black\\/50')
      const form = modalOverlay.querySelector('form')
      const roleLabel = within(form).getByText('admin.users.form.role')
      const roleSelectEl = roleLabel.closest('div').querySelector('select')
      fireEvent.change(roleSelectEl, { target: { value: 'admin' } })

      await waitFor(() => {
        // The group should appear as a pending group in the multi-group section
        expect(screen.getByText('admin.users.form.groups')).toBeInTheDocument()
        expect(screen.getByText('Group A')).toBeInTheDocument()
      })
    })

    it('clears groups when switching admin→super_admin', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByText('admin.users.newUser'))

      await waitFor(() => {
        expect(screen.getByText('admin.users.form.group')).toBeInTheDocument()
      })

      // Find role select inside the modal form
      const modalOverlay = document.querySelector('.fixed.inset-0.bg-black\\/50')
      const form = modalOverlay.querySelector('form')
      const roleLabel = within(form).getByText('admin.users.form.role')
      const roleSelectEl = roleLabel.closest('div').querySelector('select')

      // Switch to admin first
      fireEvent.change(roleSelectEl, { target: { value: 'admin' } })

      await waitFor(() => {
        expect(screen.getByText('admin.users.form.groups')).toBeInTheDocument()
      })

      // Switch to super_admin
      fireEvent.change(roleSelectEl, { target: { value: 'super_admin' } })

      await waitFor(() => {
        expect(screen.queryByText('admin.users.form.groups')).not.toBeInTheDocument()
        expect(screen.queryByText('admin.users.form.group')).not.toBeInTheDocument()
      })
    })

    it('calls addMember for each pending group when creating admin with groups', async () => {
      adminApi.createUser.mockResolvedValue({
        data: { data: { user: { id: 'new-user-id' } } },
      })
      groupsApi.addMember.mockResolvedValue({ data: {} })

      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByText('admin.users.newUser'))

      await waitFor(() => {
        expect(screen.getByText('admin.users.form.group')).toBeInTheDocument()
      })

      // Fill required fields
      const modalOverlay = document.querySelector('.fixed.inset-0.bg-black\\/50')
      const form = modalOverlay.querySelector('form')
      fireEvent.change(form.querySelector('input[type="email"]'), { target: { value: 'admin@new.com' } })
      fireEvent.change(form.querySelector('input[type="password"]'), { target: { value: 'password123' } })

      // Switch to admin role
      const roleLabel = within(form).getByText('admin.users.form.role')
      const roleSelectEl = roleLabel.closest('div').querySelector('select')
      fireEvent.change(roleSelectEl, { target: { value: 'admin' } })

      await waitFor(() => {
        expect(screen.getByText('admin.users.addGroup')).toBeInTheDocument()
      })

      // Add first group
      fireEvent.click(screen.getByText('admin.users.addGroup'))
      await waitFor(() => {
        expect(screen.getByText('admin.users.chooseGroup')).toBeInTheDocument()
      })
      const addGroupSelect = screen.getByText('admin.users.chooseGroup').closest('select')
      fireEvent.change(addGroupSelect, { target: { value: 'g1' } })
      fireEvent.click(screen.getByText('common.ok'))

      await waitFor(() => {
        expect(screen.getByText('Group A')).toBeInTheDocument()
      })

      // Add second group
      fireEvent.click(screen.getByText('admin.users.addGroup'))
      await waitFor(() => {
        expect(screen.getByText('admin.users.chooseGroup')).toBeInTheDocument()
      })
      const addGroupSelect2 = screen.getByText('admin.users.chooseGroup').closest('select')
      fireEvent.change(addGroupSelect2, { target: { value: 'g2' } })
      fireEvent.click(screen.getByText('common.ok'))

      await waitFor(() => {
        expect(screen.getByText('Group B')).toBeInTheDocument()
      })

      // Submit the form
      await act(async () => {
        fireEvent.submit(form)
      })

      await waitFor(() => {
        expect(adminApi.createUser).toHaveBeenCalled()
      })

      // Check createUser was called without pendingGroups in the user data
      const createCallArgs = adminApi.createUser.mock.calls[0][0]
      expect(createCallArgs.role).toBe('admin')
      expect(createCallArgs.pendingGroups).toBeUndefined()

      await waitFor(() => {
        expect(groupsApi.addMember).toHaveBeenCalledTimes(2)
      })

      expect(groupsApi.addMember).toHaveBeenCalledWith('g1', { userId: 'new-user-id', role: 'member' })
      expect(groupsApi.addMember).toHaveBeenCalledWith('g2', { userId: 'new-user-id', role: 'member' })
    })
  })

  describe('conditional group management - edit mode', () => {
    it('hides groups section when editing a super_admin user', async () => {
      // Mock getUser to return a super_admin
      adminApi.getUser.mockResolvedValue({
        data: {
          success: true,
          data: {
            user: { ...mockUsers[0] }, // super_admin
            groups: [],
          },
        },
      })

      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      // Click edit on first user (super_admin)
      fireEvent.click(screen.getAllByTitle('common.edit')[0])

      await waitFor(() => {
        expect(screen.getByText('admin.users.editUser')).toBeInTheDocument()
      })

      // Groups section should NOT be visible
      expect(screen.queryByText('admin.users.form.groups')).not.toBeInTheDocument()
    })

    it('hides Ajouter button when editing a user with 1 group', async () => {
      // Default mock: user u2 has 1 group (Group A)
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      // Click edit on user u2 (user role, 1 group)
      fireEvent.click(screen.getAllByTitle('common.edit')[1])

      await waitFor(() => {
        expect(screen.getByText('admin.users.editUser')).toBeInTheDocument()
      })

      await waitFor(() => {
        expect(screen.getByText('Group A')).toBeInTheDocument()
      })

      // "Ajouter" button should NOT be visible since user role is limited to 1 group
      expect(screen.queryByText('admin.users.addGroup')).not.toBeInTheDocument()
    })

    it('shows simple group dropdown with no selection when editing a user with 0 groups', async () => {
      adminApi.getUser.mockResolvedValue({
        data: {
          success: true,
          data: {
            user: { ...mockUsers[1] }, // user role
            groups: [], // no groups
          },
        },
      })

      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getAllByTitle('common.edit')[1])

      await waitFor(() => {
        expect(screen.getByText('admin.users.editUser')).toBeInTheDocument()
      })

      // User role shows simple dropdown "Groupe" (singular)
      await waitFor(() => {
        expect(screen.getByText('admin.users.form.group')).toBeInTheDocument()
      })

      // Dropdown should show empty value (no group selected)
      const groupLabel = screen.getByText('admin.users.form.group')
      const groupSelect = groupLabel.closest('div').querySelector('select')
      expect(groupSelect.value).toBe('')

      // No multi-group section or "Ajouter" button
      expect(screen.queryByText('admin.users.form.groups')).not.toBeInTheDocument()
      expect(screen.queryByText('admin.users.addGroup')).not.toBeInTheDocument()
    })

    it('shows Ajouter button when editing an admin user', async () => {
      const adminUser = { ...mockUsers[1], role: 'admin' }
      adminApi.getUser.mockResolvedValue({
        data: {
          success: true,
          data: {
            user: adminUser,
            groups: [{ id: 'g1', name: 'Group A', role: 'member' }],
          },
        },
      })
      // Also need this user in the users list
      adminApi.getUsers.mockResolvedValue({
        data: {
          data: [mockUsers[0], adminUser, mockUsers[2]],
        },
      })

      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      // Click edit on second user (admin)
      fireEvent.click(screen.getAllByTitle('common.edit')[1])

      await waitFor(() => {
        expect(screen.getByText('admin.users.editUser')).toBeInTheDocument()
      })

      await waitFor(() => {
        expect(screen.getByText('Group A')).toBeInTheDocument()
      })

      // "Ajouter" should be visible for admin role even with 1 group
      expect(screen.getByText('admin.users.addGroup')).toBeInTheDocument()
    })
  })

  describe('error handling - create mode', () => {
    it('shows toast error when createUser API fails with server message', async () => {
      adminApi.createUser.mockRejectedValue({
        response: { data: { error: { message: 'Email deja utilise' } } },
      })
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByText('admin.users.newUser'))

      await waitFor(() => {
        expect(document.querySelector('input[type="email"]')).toBeInTheDocument()
      })

      fireEvent.change(document.querySelector('input[type="email"]'), { target: { value: 'dup@test.com' } })
      fireEvent.change(document.querySelector('input[type="password"]'), { target: { value: 'Password1' } })

      const modal = document.querySelector('.fixed.inset-0')
      await act(async () => {
        fireEvent.submit(modal.querySelector('form'))
      })

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Email deja utilise')
      })
    })

    it('shows toast error with fallback message when API fails without server message', async () => {
      adminApi.createUser.mockRejectedValue(new Error('Network Error'))
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByText('admin.users.newUser'))

      await waitFor(() => {
        expect(document.querySelector('input[type="email"]')).toBeInTheDocument()
      })

      fireEvent.change(document.querySelector('input[type="email"]'), { target: { value: 'new@test.com' } })
      fireEvent.change(document.querySelector('input[type="password"]'), { target: { value: 'Password1' } })

      const modal = document.querySelector('.fixed.inset-0')
      await act(async () => {
        fireEvent.submit(modal.querySelector('form'))
      })

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Network Error')
      })
    })

    it('strips empty firstName and lastName before sending to API', async () => {
      adminApi.createUser.mockResolvedValue({ data: { data: { user: { id: 'new' } } } })
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByText('admin.users.newUser'))

      await waitFor(() => {
        expect(document.querySelector('input[type="email"]')).toBeInTheDocument()
      })

      // Leave firstName and lastName empty, only fill required fields
      fireEvent.change(document.querySelector('input[type="email"]'), { target: { value: 'minimal@test.com' } })
      fireEvent.change(document.querySelector('input[type="password"]'), { target: { value: 'Password1' } })

      const modal = document.querySelector('.fixed.inset-0')
      await act(async () => {
        fireEvent.submit(modal.querySelector('form'))
      })

      await waitFor(() => {
        expect(adminApi.createUser).toHaveBeenCalled()
      })

      const callArgs = adminApi.createUser.mock.calls[0][0]
      // Empty strings should be stripped (not sent as "")
      expect(callArgs.firstName).toBeUndefined()
      expect(callArgs.lastName).toBeUndefined()
    })

    it('shows toast error when addMember fails after user creation', async () => {
      adminApi.createUser.mockResolvedValue({
        data: { data: { user: { id: 'new-user-id' } } },
      })
      groupsApi.addMember.mockRejectedValue(new Error('Group not found'))

      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByText('admin.users.newUser'))

      await waitFor(() => {
        expect(screen.getByText('admin.users.form.group')).toBeInTheDocument()
      })

      const modalOverlay = document.querySelector('.fixed.inset-0.bg-black\\/50')
      const form = modalOverlay.querySelector('form')
      fireEvent.change(form.querySelector('input[type="email"]'), { target: { value: 'admin@new.com' } })
      fireEvent.change(form.querySelector('input[type="password"]'), { target: { value: 'Password1' } })

      // Switch to admin and add a group
      const roleLabel = within(form).getByText('admin.users.form.role')
      const roleSelectEl = roleLabel.closest('div').querySelector('select')
      fireEvent.change(roleSelectEl, { target: { value: 'admin' } })

      await waitFor(() => {
        expect(screen.getByText('admin.users.addGroup')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('admin.users.addGroup'))
      await waitFor(() => {
        expect(screen.getByText('admin.users.chooseGroup')).toBeInTheDocument()
      })
      const addGroupSelect = screen.getByText('admin.users.chooseGroup').closest('select')
      fireEvent.change(addGroupSelect, { target: { value: 'g1' } })
      fireEvent.click(screen.getByText('common.ok'))

      await act(async () => {
        fireEvent.submit(form)
      })

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Group not found')
      })
    })
  })

  describe('error handling - edit mode', () => {
    it('shows toast error when updateUser API fails', async () => {
      adminApi.updateUser.mockRejectedValue({
        response: { data: { error: { message: 'Donnees de requete invalides' } } },
      })
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getAllByTitle('common.edit')[1])

      await waitFor(() => {
        expect(screen.getByText('admin.users.editUser')).toBeInTheDocument()
      })

      // Change first name
      const modalOverlay = document.querySelector('.fixed.inset-0.bg-black\\/50')
      const form = modalOverlay.querySelector('form')
      const firstNameInput = form.querySelectorAll('input[type="text"]')[0]
      fireEvent.change(firstNameInput, { target: { value: 'Changed' } })

      await act(async () => {
        fireEvent.submit(form)
      })

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Donnees de requete invalides')
      })
    })

    it('closes modal without API call when no changes made in edit mode', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getAllByTitle('common.edit')[1])

      await waitFor(() => {
        expect(screen.getByText('admin.users.editUser')).toBeInTheDocument()
      })

      // Submit without changing anything
      const modalOverlay = document.querySelector('.fixed.inset-0.bg-black\\/50')
      const form = modalOverlay.querySelector('form')
      await act(async () => {
        fireEvent.submit(form)
      })

      // Should close modal without calling updateUser
      expect(adminApi.updateUser).not.toHaveBeenCalled()
      await waitFor(() => {
        expect(screen.queryByText('admin.users.editUser')).not.toBeInTheDocument()
      })
    })

    it('shows toast error when removeMember fails during batch save', async () => {
      const adminUser = { ...mockUsers[1], role: 'admin' }
      adminApi.getUser.mockResolvedValue({
        data: {
          success: true,
          data: {
            user: adminUser,
            groups: [{ id: 'g1', name: 'Group A', role: 'member' }],
          },
        },
      })
      adminApi.getUsers.mockResolvedValue({ data: { data: [mockUsers[0], adminUser, mockUsers[2]] } })
      groupsApi.removeMember.mockRejectedValue({
        response: { data: { error: { message: 'Cannot remove last admin' } } },
      })

      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getAllByTitle('common.edit')[1])

      await waitFor(() => {
        expect(screen.getByText('Group A')).toBeInTheDocument()
      })

      // Remove the group
      const removeBtn = screen.getByTitle('admin.users.removeFromGroup')
      await act(async () => {
        fireEvent.click(removeBtn)
      })

      // Submit
      const modalOverlay = document.querySelector('.fixed.inset-0.bg-black\\/50')
      const form = modalOverlay.querySelector('form')
      await act(async () => {
        fireEvent.submit(form)
      })

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Cannot remove last admin')
      })
    })
  })

  describe('error handling - delete user', () => {
    it('shows toast error when deleteUser API fails', async () => {
      adminApi.deleteUser.mockRejectedValue({
        response: { data: { error: { message: 'Cannot delete super admin' } } },
      })

      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByTitle('admin.users.permanentDelete'))
      fireEvent.change(screen.getByPlaceholderText('suspended@test.com'), {
        target: { value: 'suspended@test.com' },
      })

      await act(async () => {
        fireEvent.click(screen.getByText('admin.users.permanentDeleteConfirm').closest('button'))
      })

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Cannot delete super admin')
      })
    })
  })

  describe('error handling - role change', () => {
    it('shows toast error when updateUserRole API fails', async () => {
      adminApi.updateUserRole.mockRejectedValue({
        response: { data: { error: { message: 'Role invalide' } } },
      })

      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      const tableBody = document.querySelector('tbody')
      const superAdminBadge = within(tableBody).getByText('admin.users.roles.super_admin')
      fireEvent.click(superAdminBadge.closest('button'))

      await waitFor(() => {
        const dropdownMenu = document.querySelector('.absolute.right-0')
        expect(dropdownMenu).toBeInTheDocument()
      })

      const dropdownMenu = document.querySelector('.absolute.right-0')
      const adminOption = within(dropdownMenu).getByText('admin.users.roles.admin')

      await act(async () => {
        fireEvent.click(adminOption)
      })

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Role invalide')
      })
    })
  })

  describe('edge cases', () => {
    it('sends locale and currency when creating a user', async () => {
      adminApi.createUser.mockResolvedValue({ data: { data: { user: { id: 'new' } } } })
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByText('admin.users.newUser'))

      await waitFor(() => {
        expect(document.querySelector('input[type="email"]')).toBeInTheDocument()
      })

      fireEvent.change(document.querySelector('input[type="email"]'), { target: { value: 'new@test.com' } })
      fireEvent.change(document.querySelector('input[type="password"]'), { target: { value: 'Password1' } })

      const modal = document.querySelector('.fixed.inset-0')
      await act(async () => {
        fireEvent.submit(modal.querySelector('form'))
      })

      await waitFor(() => {
        expect(adminApi.createUser).toHaveBeenCalled()
      })

      const callArgs = adminApi.createUser.mock.calls[0][0]
      expect(callArgs.locale).toBe('fr')
      expect(callArgs.currency).toBe('BRL')
    })

    it('has required attribute on email input in create mode', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByText('admin.users.newUser'))

      await waitFor(() => {
        expect(document.querySelector('input[type="email"]')).toBeInTheDocument()
      })

      // Verify email field is marked as required
      expect(document.querySelector('input[type="email"]').required).toBe(true)
    })

    it('has required attribute and minLength on password input in create mode', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByText('admin.users.newUser'))

      await waitFor(() => {
        expect(document.querySelector('input[type="password"]')).toBeInTheDocument()
      })

      // Verify password field is marked as required with minLength
      const passwordInput = document.querySelector('input[type="password"]')
      expect(passwordInput.required).toBe(true)
      expect(passwordInput.minLength).toBe(8)
    })

    it('handles getUsers API failure gracefully', async () => {
      adminApi.getUsers.mockRejectedValue(new Error('Server error'))
      renderWithProviders(<AdminUsers />)

      // Should not crash, shows loading then empty
      await waitFor(() => {
        expect(screen.queryByText('admin@test.com')).not.toBeInTheDocument()
      })
    })

    it('handles getUser API failure gracefully in edit mode', async () => {
      adminApi.getUser.mockRejectedValue(new Error('User not found'))
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getAllByTitle('common.edit')[1])

      await waitFor(() => {
        expect(screen.getByText('admin.users.editUser')).toBeInTheDocument()
      })

      // Modal should still render with data from the users list
      const emailInput = document.querySelector('input[type="email"]')
      expect(emailInput.value).toBe('john@test.com')
    })

    it('keeps modal open after create API error', async () => {
      adminApi.createUser.mockRejectedValue({
        response: { data: { error: { message: 'Validation failed' } } },
      })
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      fireEvent.click(screen.getByText('admin.users.newUser'))

      await waitFor(() => {
        expect(document.querySelector('input[type="email"]')).toBeInTheDocument()
      })

      fireEvent.change(document.querySelector('input[type="email"]'), { target: { value: 'new@test.com' } })
      fireEvent.change(document.querySelector('input[type="password"]'), { target: { value: 'Password1' } })

      const modal = document.querySelector('.fixed.inset-0')
      await act(async () => {
        fireEvent.submit(modal.querySelector('form'))
      })

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled()
      })

      // Modal should still be open so user can fix the error
      expect(screen.getByRole('heading', { name: 'admin.users.newUser' })).toBeInTheDocument()
      expect(document.querySelector('input[type="email"]').value).toBe('new@test.com')
    })
  })

  describe('role dropdown', () => {
    it('shows role options when clicking the role badge button', async () => {
      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      // Find the Super Admin badge inside the table and click its parent button
      const tableBody = document.querySelector('tbody')
      const superAdminBadge = within(tableBody).getByText('admin.users.roles.super_admin')
      fireEvent.click(superAdminBadge.closest('button'))

      await waitFor(() => {
        const dropdownMenu = document.querySelector('.absolute.right-0')
        expect(dropdownMenu).toBeInTheDocument()
      })
    })

    it('calls updateUserRole when selecting a new role from dropdown', async () => {
      adminApi.updateUserRole.mockResolvedValue({ data: {} })

      renderWithProviders(<AdminUsers />)
      await waitForUsersLoaded()

      // Open dropdown for first user (super_admin)
      const tableBody = document.querySelector('tbody')
      const superAdminBadge = within(tableBody).getByText('admin.users.roles.super_admin')
      fireEvent.click(superAdminBadge.closest('button'))

      await waitFor(() => {
        const dropdownMenu = document.querySelector('.absolute.right-0')
        expect(dropdownMenu).toBeInTheDocument()
      })

      // Click "Admin" in the dropdown menu
      const dropdownMenu = document.querySelector('.absolute.right-0')
      const adminOption = within(dropdownMenu).getByText('admin.users.roles.admin')

      await act(async () => {
        fireEvent.click(adminOption)
      })

      expect(adminApi.updateUserRole).toHaveBeenCalledWith('u1', 'admin')
    })
  })
})
