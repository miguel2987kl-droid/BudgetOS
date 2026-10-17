/**
 * @fileoverview API client module for BudgetOS
 * Provides centralized API calls with CSRF protection and error handling
 */

import axios from 'axios'

/**
 * Axios instance configured for the BudgetOS API
 * @type {import('axios').AxiosInstance}
 */
const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

/** @type {string|null} Cached CSRF token */
let csrfToken = null
let activeWorkspaceId = null

export const setWorkspaceRequestContext = (workspaceId) => {
  activeWorkspaceId = workspaceId || null
}

/**
 * Fetches CSRF token from the server
 * @param {boolean} forceRefresh - Force a new token fetch even if cached
 * @returns {Promise<string|null>} The CSRF token
 */
async function fetchCsrfToken(forceRefresh = false) {
  if (!csrfToken || forceRefresh) {
    try {
      const { data } = await axios.get('/api/v1/csrf-token', { withCredentials: true })
      csrfToken = data.csrfToken
    } catch (e) {
      console.error('Failed to get CSRF token', e)
    }
  }
  return csrfToken
}

/**
 * Preloads CSRF token for faster subsequent requests
 * @returns {Promise<string|null>} The CSRF token
 */
export const preloadCsrfToken = () => fetchCsrfToken(true)

// Request interceptor: adds CSRF token to state-changing requests
api.interceptors.request.use(async (config) => {
  if (activeWorkspaceId) {
    config.headers['X-Workspace-ID'] = activeWorkspaceId
  } else {
    delete config.headers['X-Workspace-ID']
  }
  if (['post', 'put', 'patch', 'delete'].includes(config.method)) {
    const token = await fetchCsrfToken()
    if (token) {
      config.headers['X-CSRF-Token'] = token
    }
  }
  return config
})

// Response interceptor: handles CSRF errors and authentication redirects
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    // Retry with a fresh CSRF token only when the 403 is caused by an invalid
    // CSRF token. Genuine authorization denials must not be retried.
    if (
      error.response?.status === 403 &&
      error.response?.data?.error?.code === 'CSRF_TOKEN_INVALID' &&
      !originalRequest._retry
    ) {
      originalRequest._retry = true
      csrfToken = null
      const newToken = await fetchCsrfToken(true)
      originalRequest.headers['X-CSRF-Token'] = newToken
      return api(originalRequest)
    }
    // Redirect to login on 401 (unless already on a public auth page)
    if (error.response?.status === 401) {
      const publicPages = ['/login', '/register', '/forgot-password', '/reset-password']
      const isPublicPage = publicPages.some(p => window.location.pathname.startsWith(p))
      if (!isPublicPage) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

/**
 * Authentication API endpoints
 * @namespace authApi
 */
export const authApi = {
  /** @param {Object} data - Login credentials (email, password) */
  login: (data) => api.post('/auth/login', data),
  /** @param {Object} data - Registration data (email, password, name) */
  register: (data) => api.post('/auth/register', data),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get('/auth/me'),
  getSetupStatus: () => api.get('/auth/setup-status'),
  getSettings: () => api.get('/auth/settings'),
  /** @param {Object} data - Settings data (weekStartDay, dateFormat, etc.) */
  updateSettings: (data) => api.put('/auth/settings', data),
  /** @param {string} email - User email for password reset */
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  /** @param {string} token - Reset token to validate */
  validateResetToken: (token) => api.get('/auth/validate-reset-token', { params: { token } }),
  /** @param {string} token - Reset token */
  resetPassword: (token, password, passwordConfirm) => api.post('/auth/reset-password', { token, password, passwordConfirm }),
}

export const workspaceApi = {
  getAll: () => api.get('/workspaces'),
  create: (data) => api.post('/workspaces', data),
  activate: (workspaceId) => api.post(`/workspaces/${workspaceId}/activate`),
  deactivate: (workspaceId) => api.post(`/workspaces/${workspaceId}/deactivate`),
  reactivate: (workspaceId) => api.post(`/workspaces/${workspaceId}/reactivate`),
  updateNotes: (workspaceId, notes) => api.put(`/workspaces/${workspaceId}/notes`, notes),
  delete: (workspaceId) => api.delete(`/workspaces/${workspaceId}`),
  getArchived: () => api.get('/workspaces/archived'),
  restore: (workspaceId) => api.post(`/workspaces/${workspaceId}/restore`),
  getMembers: (workspaceId) => api.get(`/workspaces/${workspaceId}/members`),
  /** @param {{ email: string, role: 'owner'|'collaborator'|'client' }} data */
  addMember: (workspaceId, data) => api.post(`/workspaces/${workspaceId}/members`, data),
  updateMember: (workspaceId, userId, role) => api.put(`/workspaces/${workspaceId}/members/${userId}`, { role }),
  removeMember: (workspaceId, userId) => api.delete(`/workspaces/${workspaceId}/members/${userId}`),
}

/**
 * Accounts API endpoints
 * @namespace accountsApi
 */
export const accountsApi = {
  /** @param {Object} [params] - Optional filters (e.g. { includeInactive: true }) */
  getAll: (params) => api.get('/accounts', { params: cleanParams(params || {}) }),
  /** @param {string} id - Account UUID */
  getOne: (id) => api.get(`/accounts/${id}`),
  /** @param {Object} data - Account data (name, type, currency, etc.) */
  create: (data) => api.post('/accounts', data),
  /** @param {string} id - Account UUID */
  update: (id, data) => api.put(`/accounts/${id}`, data),
  /** Permanent delete - account must be deactivated first */
  delete: (id) => api.delete(`/accounts/${id}`),
  /** Soft-disable: hides the account from totals/lists, pauses planned transactions */
  deactivate: (id) => api.post(`/accounts/${id}/deactivate`),
  /** Re-enable a previously deactivated account */
  reactivate: (id) => api.post(`/accounts/${id}/reactivate`),
  /** Batch balance update: { date, items: [{ accountId, balance }] } */
  updateBalances: (data) => api.post('/accounts/balances', data),
}

/**
 * Finance module endpoints (permissions, parameters, audit trail)
 * @namespace financeApi
 */
export const financeApi = {
  getContext: () => api.get('/finance/context'),
  updateParameters: (data) => api.put('/finance/parameters', data),
  /** @param {{ entity?: string, entityId?: string, limit?: number }} params */
  getAudit: (params) => api.get('/finance/audit', { params: cleanParams(params || {}) }),
}

/**
 * PAINEL operations (R2): invoices, card sales, bank entries, recurrences, revenues
 * @namespace operationsApi
 */
export const operationsApi = {
  invoices: {
    list: (params) => api.get('/invoices', { params: cleanParams(params || {}) }),
    get: (id) => api.get(`/invoices/${id}`),
    summary: () => api.get('/invoices/summary'),
    pay: (id, data) => api.post(`/invoices/${id}/payments`, data),
    deletePayment: (paymentId) => api.delete(`/invoices/payments/${paymentId}`),
  },
  cardSales: {
    list: (params) => api.get('/card-sales', { params: cleanParams(params || {}) }),
    create: (data) => api.post('/card-sales', data),
    update: (id, data) => api.put(`/card-sales/${id}`, data),
    delete: (id) => api.delete(`/card-sales/${id}`),
    credit: (installmentId, data) => api.post(`/card-sales/installments/${installmentId}/credit`, data),
    undoCredit: (installmentId) => api.delete(`/card-sales/installments/${installmentId}/credit`),
  },
  bankEntries: {
    list: (params) => api.get('/bank-entries', { params: cleanParams(params || {}) }),
    create: (data) => api.post('/bank-entries', data),
    update: (id, data) => api.put(`/bank-entries/${id}`, data),
    delete: (id) => api.delete(`/bank-entries/${id}`),
  },
  recurrences: {
    list: (params) => api.get('/recurrences', { params: cleanParams(params || {}) }),
    month: (month) => api.get('/recurrences/month', { params: { month } }),
    create: (data) => api.post('/recurrences', data),
    update: (id, data) => api.put(`/recurrences/${id}`, data),
    adjust: (id, data) => api.post(`/recurrences/${id}/adjust`, data),
    end: (id, data) => api.post(`/recurrences/${id}/end`, data),
    delete: (id) => api.delete(`/recurrences/${id}`),
    pay: (installmentId, data) => api.post(`/recurrences/installments/${installmentId}/pay`, data),
    undoPayment: (installmentId) => api.delete(`/recurrences/installments/${installmentId}/pay`),
  },
  revenues: {
    list: (params) => api.get('/revenues', { params: cleanParams(params || {}) }),
    consolidated: (params) => api.get('/revenues/consolidated', { params }),
    create: (data) => api.post('/revenues', data),
    update: (id, data) => api.put(`/revenues/${id}`, data),
    cancel: (id) => api.post(`/revenues/${id}/cancel`),
    delete: (id) => api.delete(`/revenues/${id}`),
    receive: (installmentId, data) => api.post(`/revenues/installments/${installmentId}/receive`, data),
    undoReceipt: (installmentId) => api.delete(`/revenues/installments/${installmentId}/receive`),
  },
}

/**
 * Removes empty, null, or undefined values from params object
 * @param {Object} params - Query parameters
 * @returns {Object} Cleaned parameters
 */
const cleanParams = (params) => {
  const cleaned = {}
  for (const [key, value] of Object.entries(params)) {
    if (value !== '' && value !== null && value !== undefined) {
      cleaned[key] = value
    }
  }
  return cleaned
}

/**
 * Transactions API endpoints
 * @namespace transactionsApi
 */
export const transactionsApi = {
  /** @param {Object} params - Filter params (accountId, startDate, endDate, etc.) */
  getAll: (params) => api.get('/transactions', { params: cleanParams(params) }),
  /** @param {string} id - Transaction UUID */
  getOne: (id) => api.get(`/transactions/${id}`),
  /** @param {Object} data - Transaction data (amount, description, date, etc.) */
  create: (data) => api.post('/transactions', data),
  /** @param {string} id - Transaction UUID */
  update: (id, data) => api.put(`/transactions/${id}`, data),
  /** @param {string} id - Transaction UUID */
  delete: (id) => api.delete(`/transactions/${id}`),
  /** @param {string} id - Transaction UUID - Toggle reconciliation status */
  toggleReconcile: (id) => api.patch(`/transactions/${id}/reconcile`),
}

/**
 * Categories API endpoints
 * @namespace categoriesApi
 */
export const categoriesApi = {
  /** @param {Object} params - Filter params (type: income/expense/transfer) */
  getAll: (params) => api.get('/categories', { params }),
  /** @param {Object} data - Category data (name, type, icon, color) */
  create: (data) => api.post('/categories', data),
  /** @param {string} id - Category UUID */
  update: (id, data) => api.put(`/categories/${id}`, data),
  /** @param {string} id - Category UUID */
  delete: (id) => api.delete(`/categories/${id}`),
}

/**
 * Credit Cards API endpoints
 * @namespace creditCardsApi
 */
export const creditCardsApi = {
  /** @param {Object} params - Filter params (status: active/expired, sortBy, sortOrder) */
  getAll: (params) => api.get('/credit-cards', { params: cleanParams(params || {}) }),
  /** @param {string} id - Credit card UUID */
  getOne: (id) => api.get(`/credit-cards/${id}`),
  /** @param {Object} data - Credit card data (name, accountId, debitType, etc.) */
  create: (data) => api.post('/credit-cards', data),
  /** @param {string} id - Credit card UUID */
  update: (id, data) => api.put(`/credit-cards/${id}`, data),
  /** @param {string} id - Credit card UUID */
  delete: (id) => api.delete(`/credit-cards/${id}`),
  /** @param {string} id - Credit card UUID */
  getCycles: (id) => api.get(`/credit-cards/${id}/cycles`),
  /** @param {string} id - Credit card UUID */
  getCurrentCycle: (id) => api.get(`/credit-cards/${id}/cycles/current`),
}

/**
 * Reports API endpoints
 * @namespace reportsApi
 */
export const reportsApi = {
  getDashboard: () => api.get('/reports/dashboard'),
  /** @param {Object} params - Date range params (startDate, endDate) */
  getExpensesByCategory: (params) => api.get('/reports/expenses/category', { params }),
  getIncomeByCategory: (params) => api.get('/reports/income/category', { params }),
  /** @param {Object} params - Date range params */
  getMonthlyTrend: (params) => api.get('/reports/trend/monthly', { params }),
  /** @param {Object} params - Forecast params (days: 30/60/90) */
  getForecast: (params) => api.get('/reports/forecast', { params }),
  getForecastTransactions: (params) => api.get('/reports/forecast/transactions', { params: cleanParams(params) }),
  getProjections: () => api.get('/reports/projections'),
}

/**
 * Payees API endpoints
 * @namespace payeesApi
 */
export const payeesApi = {
  /** @param {Object} params - Filter params (search, limit) */
  getAll: (params) => api.get('/payees', { params: cleanParams(params || {}) }),
  /** @param {string} id - Payee UUID */
  getOne: (id) => api.get(`/payees/${id}`),
  /** @param {Object} data - Payee data (name, imageUrl) */
  create: (data) => api.post('/payees', data),
  /** @param {string} id - Payee UUID */
  update: (id, data) => api.put(`/payees/${id}`, data),
  /** @param {string} id - Payee UUID */
  delete: (id) => api.delete(`/payees/${id}`),
  /** @param {string} id - Payee UUID */
  getTransactionCount: (id) => api.get(`/payees/${id}/transactions/count`),
  /**
   * Reassigns all transactions from one payee to another
   * @param {string} id - Source payee UUID
   * @param {string} toPayeeId - Target payee UUID
   */
  reassignTransactions: (id, toPayeeId) => api.post(`/payees/${id}/transactions/reassign`, { toPayeeId }),
}

/**
 * File uploads API endpoints
 * @namespace uploadsApi
 */
export const uploadsApi = {
  /**
   * Uploads a payee image
   * @param {File} file - Image file to upload
   * @returns {Promise} Response with imageUrl
   */
  uploadPayeeImage: (file) => {
    const formData = new FormData()
    formData.append('image', file)
    return api.post('/uploads/payee-image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  /**
   * Deletes a payee image
   * @param {string} imageUrl - URL of the image to delete
   */
  deletePayeeImage: (imageUrl) => api.delete('/uploads/payee-image', { data: { imageUrl } }),
}

/**
 * Admin API endpoints (super_admin only)
 * @namespace adminApi
 */
export const adminApi = {
  /** @param {Object} params - Filter params (search, role, status) */
  getUsers: (params) => api.get('/admin/users', { params: cleanParams(params || {}) }),
  /** @param {string} id - User UUID */
  getUser: (id) => api.get(`/admin/users/${id}`),
  /** @param {Object} data - User data (email, password, firstName, lastName, role) */
  createUser: (data) => api.post('/admin/users', data),
  /** @param {string} id - User UUID */
  updateUser: (id, data) => api.put(`/admin/users/${id}`, data),
  /** @param {string} id - User UUID */
  suspendUser: (id) => api.put(`/admin/users/${id}/suspend`),
  /** @param {string} id - User UUID */
  reactivateUser: (id) => api.put(`/admin/users/${id}/reactivate`),
  /** @param {string} id - User UUID */
  deleteUser: (id) => api.delete(`/admin/users/${id}`),
  /** @param {string} id - User UUID */
  updateUserRole: (id, role) => api.put(`/admin/users/${id}/role`, { role }),
  getSettings: () => api.get('/admin/settings'),
  /** @param {Object} data - Settings data (publicRegistration, defaultGroupId) */
  updateSettings: (data) => api.put('/admin/settings', data),
  getSmtpSettings: () => api.get('/admin/smtp'),
  /** @param {Object} data - SMTP settings (smtpHost, smtpPort, etc.) */
  updateSmtpSettings: (data) => api.put('/admin/smtp', data),
  testSmtpConnection: () => api.post('/admin/smtp/test'),
  /** Preview duplicate recurring transactions caused by past scheduler bug */
  previewRecurringDuplicates: () => api.get('/admin/duplicates/recurring'),
  /** Cleanup duplicate recurring transactions */
  cleanupRecurringDuplicates: () => api.post('/admin/duplicates/recurring/cleanup'),
  getFinanceAccess: () => api.get('/admin/finance/access'),
  updateFinanceRoles: (roleMap) => api.put('/admin/finance/roles', roleMap),
  updateFinancePermissions: (matrix) => api.put('/admin/finance/permissions', { matrix }),
  resetFinancePermissions: () => api.post('/admin/finance/permissions/reset'),
  updateFinanceSettings: (data) => api.put('/admin/finance/settings', data),
  getIntegrationHealth: () => api.get('/admin/integration-health'),
}

/**
 * Groups API endpoints
 * @namespace groupsApi
 */
export const groupsApi = {
  /** @param {Object} params - Filter params (search, status) */
  getAll: (params) => api.get('/groups', { params: cleanParams(params || {}) }),
  /** @param {string} id - Group UUID */
  getOne: (id) => api.get(`/groups/${id}`),
  /** @param {Object} data - Group data (name, description) */
  create: (data) => api.post('/groups', data),
  /** @param {string} id - Group UUID */
  update: (id, data) => api.put(`/groups/${id}`, data),
  /** @param {string} id - Group UUID */
  delete: (id) => api.delete(`/groups/${id}`),
  /** @param {string} groupId - Group UUID */
  getMembers: (groupId, params) => api.get(`/groups/${groupId}/members`, { params: cleanParams(params || {}) }),
  /** @param {string} groupId - Group UUID */
  addMember: (groupId, data) => api.post(`/groups/${groupId}/members`, data),
  /** @param {string} groupId - Group UUID */
  updateMember: (groupId, userId, role) => api.put(`/groups/${groupId}/members/${userId}`, { role }),
  /** @param {string} groupId - Group UUID */
  removeMember: (groupId, userId) => api.delete(`/groups/${groupId}/members/${userId}`),
}

/**
 * Import API endpoints
 * @namespace importApi
 */
export const importApi = {
  /**
   * Analyze a bank file: upload, parse, enrich, find matches
   * @param {FormData} formData - File + accountId + fileType + config
   */
  analyze: (formData) => api.post('/import/analyze', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  /**
   * Confirm import with user-defined actions
   * @param {Object} data - { importId, actions, autoCategories }
   */
  confirm: (data) => api.post('/import/confirm', data),
  /** @param {Object} params - Filter params (accountId, status, page, limit) */
  getHistory: (params) => api.get('/import/history', { params: cleanParams(params || {}) }),
  /** @param {string} id - Import UUID */
  getOne: (id) => api.get(`/import/${id}`),
  /** @param {Object} params - { accountId, amount, date } */
  getMatchCandidates: (params) => api.get('/import/match-candidates', { params }),
}

export default api
