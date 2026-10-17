/**
 * @fileoverview Transactions management page
 * Provides CRUD operations with filtering, search, and infinite scroll
 */

import { useState, useRef, useEffect, useCallback, useMemo, useDeferredValue, Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { getPersistedAccountTab, setPersistedAccountTab } from '../lib/accountTabPersistence'
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { transactionsApi, accountsApi, categoriesApi, payeesApi, creditCardsApi } from '../lib/api'
import { getDatePeriod, formatLocalDate } from '../lib/utils'
import { translateError } from '../lib/errorHelper'
import { useFormatters, parseAmount } from '../hooks/useFormatters'
import FormattedAmountInput from '../components/FormattedAmountInput'
import { getIconComponent } from '../lib/iconMap'
import {
  Plus, Search, TrendingUp, TrendingDown,
  ArrowLeftRight, X, Calendar, Pencil, Trash2, Tag, Users, Loader2,
  CheckCircle2, Scale, ArrowUpDown, ArrowUp, ArrowDown,
  ChevronDown, ChevronRight, RotateCcw, CreditCard, AlertTriangle
} from 'lucide-react'
import SearchableSelect from '../components/SearchableSelect'
import Modal from '../components/Modal'
import ConfirmModal from '../components/ConfirmModal'
import AccountTabs from '../components/AccountTabs'
import { useToast } from '../components/Toast'
import { findKnownLogo } from '../lib/knownLogos'
import { useAuth } from '../contexts/AuthContext'
import TransactionExpandedRow, { hasExpandableDetails } from '../components/TransactionExpandedRow'

/**
 * Sort icon component for table headers
 * Extracted outside component to prevent recreation on each render
 * @param {Object} props - Component props
 * @param {string} props.column - Column name
 * @param {Object} props.sort - Current sort state { sortBy, sortOrder }
 */
const SortIcon = ({ column, sort }) => {
  if (sort.sortBy !== column) {
    return <ArrowUpDown className="w-3 h-3 text-gray-400" />
  }
  return sort.sortOrder === 'asc'
    ? <ArrowUp className="w-3 h-3 text-primary-600" />
    : <ArrowDown className="w-3 h-3 text-primary-600" />
}

/**
 * Category icon component with background
 * @param {Object} props - Component props
 * @param {string} props.icon - Icon name
 * @param {string} props.color - Icon color
 */
const CategoryIcon = ({ icon, color }) => {
  const IconComp = getIconComponent(icon)
  return (
    <div
      className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
      style={{ backgroundColor: (color || '#6B7280') + '20', color: color || '#6B7280' }}
    >
      <IconComp className="w-3 h-3" />
    </div>
  )
}

/**
 * Transaction type icon component
 * @param {Object} props - Component props
 * @param {string} props.type - Transaction type (income, expense, transfer)
 * @param {number} props.amount - Transaction amount (positive or negative)
 */
const TransactionTypeIcon = ({ type, amount }) => {
  if (type === 'income') {
    return (
      <div className="w-6 h-6 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
        <TrendingUp className="w-3.5 h-3.5 text-green-600" />
      </div>
    )
  }
  if (type === 'expense') {
    return (
      <div className="w-6 h-6 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
        <TrendingDown className="w-3.5 h-3.5 text-red-600" />
      </div>
    )
  }
  // Transfer: amount >= 0 means incoming (credit), amount < 0 means outgoing (debit)
  const isIncoming = amount >= 0
  return (
    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
      isIncoming ? 'bg-green-100' : 'bg-red-100'
    }`}>
      <ArrowLeftRight className={`w-3.5 h-3.5 ${
        isIncoming ? 'text-green-600 rotate-180' : 'text-red-600'
      }`} />
    </div>
  )
}

/**
 * Modal form for creating or editing a transaction
 * Supports income, expense, and transfer types
 * @param {Object} props - Component props
 * @param {Object|null} props.transaction - Existing transaction for editing, null for creation
 * @param {Array} props.accounts - Available bank accounts
 * @param {Array} props.categories - Available categories
 * @param {Array} props.payees - Available payees
 * @param {Function} props.onClose - Callback when modal is closed
 * @param {Function} props.onSave - Callback with form data when saved
 * @param {Function} props.onCreatePayee - Callback to create a new payee inline
 * @param {Function} props.onCreateCategory - Callback to create a new category inline
 */
export function TransactionModal({ transaction, accounts, categories, payees, creditCards, defaultAccountId, defaultType = 'expense', onClose, onSave, onCreatePayee, onCreateCategory, toast }) {
  const { t, i18n } = useTranslation()
  const { formatCurrency } = useFormatters()
  const [formData, setFormData] = useState(() => {
    if (transaction) {
      return { ...transaction, amount: transaction.amount != null ? String(Math.abs(transaction.amount)) : '' }
    }
    return {
      accountId: defaultAccountId || accounts?.[0]?.id || '',
      toAccountId: '',
      categoryId: '',
      payeeId: '',
      amount: '',
      description: '',
      date: formatLocalDate(new Date()),
      type: defaultType,
      checkNumber: '',
      creditCardId: '',
      installmentCount: 1,
    }
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    // For transfers, at least one account must be selected
    if (formData.type === 'transfer' && !formData.accountId && !formData.toAccountId) {
      toast.error(t('transactions.selectOneAccount'))
      return
    }
    // For non-transfers, account is required
    if (formData.type !== 'transfer' && !formData.accountId) {
      toast.error(t('transactions.selectAccountRequired'))
      return
    }
    // Card/account consistency: selected account must match the card's account
    if (isAccountCardMismatch) {
      const cardAccount = accounts?.find(a => a.id === selectedCard.accountId)
      toast.error(t('transactions.accountCardMismatch', { cardName: selectedCard.name, accountName: cardAccount?.name || '' }))
      return
    }
    // Check/account consistency: checks can only be used with checking accounts
    if (isCheckWithNonChecking) {
      toast.error(t('transactions.checkRequiresChecking'))
      return
    }
    onSave(formData)
  }

  // Filter categories by selected type, memoized to avoid re-sorting on every render
  const filteredCategories = useMemo(() =>
    categories?.filter(c => c.type === formData.type || c.type === 'transfer')
      .sort((a, b) => a.name.localeCompare(b.name, i18n.language)) || []
  , [categories, formData.type, i18n.language])

  const sortedPayees = useMemo(() =>
    payees ? [...payees].sort((a, b) => a.name.localeCompare(b.name, i18n.language)) : []
  , [payees, i18n.language])

  // Derived variables for card/check ↔ account consistency
  const selectedCard = creditCards?.find(cc => cc.id === formData.creditCardId && formData.creditCardId !== '__selecting__')
  const selectedAccount = accounts?.find(a => a.id === formData.accountId)
  const isAccountCardMismatch = selectedCard && formData.accountId && formData.accountId !== selectedCard.accountId
  const isCheckWithNonChecking = formData.checkNumber && formData.checkNumber !== '__selecting__' && selectedAccount && selectedAccount.type !== 'checking'

  return (
    <Modal onClose={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white">
          <h2 className="text-lg font-semibold">
            {transaction ? t('transactions.editTransaction') : t('transactions.newTransaction')}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Type */}
          <div className="flex gap-2">
            {[
              { value: 'expense', label: t('transactions.types.expense'), icon: TrendingDown, color: 'red' },
              { value: 'income', label: t('transactions.types.income'), icon: TrendingUp, color: 'green' },
              { value: 'transfer', label: t('transactions.types.transfer'), icon: ArrowLeftRight, color: 'blue' },
            ].map(({ value, label, icon: Icon, color }) => (
              <button
                key={value}
                type="button"
                onClick={() => setFormData({ ...formData, type: value })}
                className={`flex-1 p-3 rounded-lg border-2 transition-colors flex flex-col items-center gap-1 ${
                  formData.type === value 
                    ? `border-${color}-500 bg-${color}-50` 
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <Icon className={`w-5 h-5 ${formData.type === value ? `text-${color}-600` : 'text-gray-400'}`} />
                <span className="text-sm">{label}</span>
              </button>
            ))}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.amount')}</label>
            <FormattedAmountInput
              value={formData.amount}
              onChange={(val) => setFormData({ ...formData, amount: val })}
              className="input text-2xl font-bold text-center"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.description')}</label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="input"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('common.date')}</label>
            <input
              type="date"
              value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
              className="input"
              required
            />
          </div>

          {formData.type !== 'transfer' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('transactions.paymentMethod')} ({t('common.optional')})
              </label>
              {!formData.creditCardId && !formData.checkNumber ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, creditCardId: '__selecting__' })}
                    className="flex-1 p-2 border-2 border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 transition-colors flex items-center justify-center gap-2 text-sm text-gray-600"
                  >
                    <CreditCard className="w-4 h-4" />
                    {t('transactions.card')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, checkNumber: '__selecting__' })}
                    className="flex-1 p-2 border-2 border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2 text-sm text-gray-600"
                  >
                    <Tag className="w-4 h-4" />
                    {t('transactions.check')}
                  </button>
                </div>
              ) : formData.creditCardId ? (
                <div className="flex gap-2">
                  <select
                    value={formData.creditCardId === '__selecting__' ? '' : formData.creditCardId}
                    onChange={(e) => {
                      const cardId = e.target.value || ''
                      const card = creditCards?.find(cc => cc.id === cardId)
                      setFormData({
                        ...formData,
                        creditCardId: cardId,
                        installmentCount: 1,
                        checkNumber: '',
                        ...(card?.accountId ? { accountId: card.accountId } : {})
                      })
                    }}
                    className="input flex-1"
                  >
                    <option value="">{t('transactions.selectCard')}</option>
                    {creditCards?.map((cc) => (
                      <option key={cc.id} value={cc.id}>{cc.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, creditCardId: '' })}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title={t('common.cancel')}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={formData.checkNumber === '__selecting__' ? '' : (formData.checkNumber || '')}
                    onChange={(e) => {
                      const val = e.target.value
                      const currentAcct = accounts?.find(a => a.id === formData.accountId)
                      const needsSwitch = val && currentAcct && currentAcct.type !== 'checking'
                      const firstChecking = needsSwitch ? accounts?.find(a => a.type === 'checking') : null
                      setFormData({
                        ...formData,
                        checkNumber: val,
                        creditCardId: '',
                        ...(firstChecking ? { accountId: firstChecking.id } : {})
                      })
                    }}
                    className="input flex-1"
                    maxLength={50}
                    placeholder="Ex: 0001234"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setFormData({ ...formData, checkNumber: '' })}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    title={t('common.cancel')}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
              {!transaction && formData.type === 'expense' && selectedCard?.debitType === 'deferred' && formData.creditCardId && formData.creditCardId !== '__selecting__' && (
                <div className="mt-3">
                  <label htmlFor="installment-count" className="mb-1 block text-sm font-medium text-gray-700">
                    {t('transactions.installments.label', { defaultValue: 'Parcelamento' })}
                  </label>
                  <select
                    id="installment-count"
                    value={formData.installmentCount || 1}
                    onChange={(event) => setFormData({ ...formData, installmentCount: Number(event.target.value) })}
                    className="input"
                  >
                    {[...Array(12)].map((_, index) => (
                      <option key={index + 1} value={index + 1}>
                        {index === 0
                          ? t('transactions.installments.single', { defaultValue: 'À vista' })
                          : t('transactions.installments.count', { count: index + 1, defaultValue: '{{count}} parcelas' })}
                      </option>
                    ))}
                  </select>
                  {Number(formData.installmentCount) > 1 && (
                    <p className="mt-1 text-xs text-gray-500">
                      {t('transactions.installments.preview', {
                        amount: formatCurrency(parseAmount(formData.amount) / Number(formData.installmentCount)),
                        defaultValue: 'Cada parcela será lançada em um ciclo mensal separado.',
                      })}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Accounts - different display for transfers */}
          {formData.type === 'transfer' ? (
            <div className="space-y-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('transactions.sourceAccountOptional')}
                </label>
                <select
                  value={formData.accountId}
                  onChange={(e) => {
                    const val = e.target.value
                    setFormData({
                      ...formData,
                      accountId: val,
                      ...(val && formData.toAccountId ? { payeeId: '' } : {})
                    })
                  }}
                  className="input"
                >
                  <option value="" disabled={!formData.toAccountId}>{t('transactions.noSourceExternal')}</option>
                  {accounts?.map((a) => (
                    <option key={a.id} value={a.id} disabled={a.id === formData.toAccountId}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-center">
                <ArrowLeftRight className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('transactions.destAccount')}
                </label>
                <select
                  value={formData.toAccountId}
                  onChange={(e) => {
                    const val = e.target.value
                    setFormData({
                      ...formData,
                      toAccountId: val,
                      ...(val && formData.accountId ? { payeeId: '' } : {})
                    })
                  }}
                  className="input"
                >
                  <option value="" disabled={!formData.accountId}>{t('transactions.noSourceExternal')}</option>
                  {accounts?.map((a) => (
                    <option key={a.id} value={a.id} disabled={a.id === formData.accountId}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <div>
              <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
                {t('transactions.account')}
                {(isAccountCardMismatch || isCheckWithNonChecking) && (
                  <span className="relative group">
                    <AlertTriangle className="w-4 h-4 text-amber-500 cursor-help" />
                    <span className="pointer-events-none absolute left-0 bottom-full mb-1 z-50 w-64 rounded bg-gray-900 px-3 py-2 text-xs text-gray-50 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                      {isAccountCardMismatch
                        ? t('transactions.accountCardMismatch', {
                            cardName: selectedCard.name,
                            accountName: accounts?.find(a => a.id === selectedCard.accountId)?.name || ''
                          })
                        : t('transactions.checkRequiresChecking')
                      }
                    </span>
                  </span>
                )}
              </label>
              <select
                value={formData.accountId}
                onChange={(e) => setFormData({ ...formData, accountId: e.target.value })}
                className={`input ${isAccountCardMismatch || isCheckWithNonChecking ? 'border-amber-400 ring-1 ring-amber-200' : ''}`}
                required
              >
                <option value="">{t('transactions.selectAccount')}</option>
                {accounts?.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('transactions.category')}</label>
            <SearchableSelect
              value={formData.categoryId}
              onChange={(id) => setFormData({ ...formData, categoryId: id })}
              options={filteredCategories}
              placeholder={t('transactions.searchCategories')}
              emptyMessage={t('transactions.noCategory')}
              allowCreate={!!onCreateCategory}
              createLabel={t('transactions.createCategory')}
              onCreate={(name) => onCreateCategory(name, formData.type)}
              renderOption={(cat) => {
                const IconComp = getIconComponent(cat.icon)
                return (
                  <span className="flex items-center gap-2">
                    <span style={{ color: cat.color || '#6B7280' }}>
                      <IconComp className="w-4 h-4" />
                    </span>
                    {cat.name}
                  </span>
                )
              }}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('transactions.payeeOptional')}
              {formData.type === 'transfer' && formData.accountId && formData.toAccountId && (
                <span className="text-xs text-gray-400 ml-2">{t('transactions.disabledInternalTransfer')}</span>
              )}
            </label>
            <SearchableSelect
              value={formData.payeeId}
              onChange={(id) => setFormData({ ...formData, payeeId: id })}
              options={sortedPayees}
              placeholder={t('transactions.searchPayees')}
              emptyMessage={t('transactions.noPayee')}
              allowCreate={!!onCreatePayee}
              createLabel={t('transactions.createPayee')}
              onCreate={onCreatePayee}
              disabled={formData.type === 'transfer' && !!formData.accountId && !!formData.toAccountId}
              renderOption={(p) => (
                <span className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-gray-400" />
                  {p.name}
                </span>
              )}
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="btn btn-secondary flex-1">
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn btn-primary flex-1">
              {transaction ? t('common.edit') : t('common.create')}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}

/**
 * Transactions page component
 * Displays all transactions with filtering, search, and infinite scroll
 * Supports creating, editing, and deleting transactions
 * @returns {JSX.Element} The transactions page
 */
export default function Transactions() {
  const { t } = useTranslation()
  const { formatCurrency, formatDate } = useFormatters()
  const { userSettings } = useAuth()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [modalOpen, setModalOpen] = useState(false)
  const [defaultType, setDefaultType] = useState('expense')
  const [editingTx, setEditingTx] = useState(null)
  const [deleteCandidate, setDeleteCandidate] = useState(null)
  /** @type {Set<string>} Set of expanded transaction IDs */
  const [expandedRows, setExpandedRows] = useState(new Set())
  /** @type {boolean} Whether reconciliation mode is active */
  const [reconcileMode, setReconcileMode] = useState(() => searchParams.get('reconcile') === '1')
  /** @type {string} Search input value (immediate) */
  const [searchInput, setSearchInput] = useState('')
  /** @type {string} Deferred search value (debounced) */
  const deferredSearch = useDeferredValue(searchInput)
  /** @type {string} Currently selected account tab ('' = all accounts) */
  const initialAccount = searchParams.get('account') || getPersistedAccountTab()
  const [accountTab, setAccountTab] = useState(initialAccount)
  /** @type {Object} Filter state for account, category, type, reconciliation status, and date range */
  const [filters, setFilters] = useState({
    accountId: initialAccount,
    categoryId: '',
    type: '',
    isReconciled: '',
    startDate: '',
    endDate: ''
  })
  /** @type {Object} Sort state for column sorting */
  const [sort, setSort] = useState({ sortBy: 'date', sortOrder: 'desc' })
  /** @type {string} Quick period filter selection */
  const [quickPeriod, setQuickPeriod] = useState('')
  const queryClient = useQueryClient()
  /** @type {React.RefObject} Reference for infinite scroll trigger element */
  const loadMoreRef = useRef(null)

  // Check if any filter or search is active
  const hasActiveFilters = useMemo(() => {
    return searchInput || filters.accountId || filters.categoryId ||
      filters.type || filters.isReconciled || filters.startDate || filters.endDate
  }, [searchInput, filters])

  const invalidateTransactionQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['transactions'] })
    queryClient.invalidateQueries({ queryKey: ['accounts'] })
    queryClient.invalidateQueries({ queryKey: ['credit-cards'] })
    queryClient.invalidateQueries({ queryKey: ['credit-card-cycle'] })
  }

  const closeTransactionModal = () => {
    setModalOpen(false)
    setEditingTx(null)
    if (searchParams.has('new')) {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.delete('new')
      setSearchParams(nextParams, { replace: true })
    }
  }

  const toggleReconcileMode = () => {
    const nextMode = !reconcileMode
    const nextParams = new URLSearchParams(searchParams)
    if (nextMode) nextParams.set('reconcile', '1')
    else nextParams.delete('reconcile')
    setSearchParams(nextParams, { replace: true })
    setReconcileMode(nextMode)
  }

  // Handle account tab change
  const handleAccountTab = useCallback((accountId) => {
    setAccountTab(accountId)
    setFilters(prev => ({ ...prev, accountId }))
    setPersistedAccountTab(accountId)
    const nextParams = new URLSearchParams(searchParams)
    if (accountId) nextParams.set('account', accountId)
    else nextParams.delete('account')
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])

  // Reset all filters and search
  const resetAllFilters = useCallback(() => {
    setSearchInput('')
    setAccountTab('')
    setPersistedAccountTab('')
    setFilters({ accountId: '', categoryId: '', type: '', isReconciled: '', startDate: '', endDate: '' })
    setQuickPeriod('')
    const nextParams = new URLSearchParams()
    if (reconcileMode) nextParams.set('reconcile', '1')
    setSearchParams(nextParams, { replace: true })
  }, [reconcileMode, setSearchParams])

  // Combine filters with deferred search for API call
  const queryFilters = useMemo(() => ({
    ...filters,
    search: deferredSearch
  }), [filters, deferredSearch])

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['transactions', queryFilters, sort],
    queryFn: ({ pageParam = 1 }) =>
      transactionsApi.getAll({ ...queryFilters, ...sort, page: pageParam, limit: 10 }).then(r => r.data),
    getNextPageParam: (lastPage) => {
      if (lastPage.pagination.page < lastPage.pagination.totalPages) {
        return lastPage.pagination.page + 1
      }
      return undefined
    },
  })

  /**
   * Handles column header click for sorting
   * Cycle: desc -> asc -> neutral (default: date desc)
   */
  const handleSort = useCallback((column) => {
    setSort(prev => {
      if (prev.sortBy !== column) {
        return { sortBy: column, sortOrder: 'desc' }
      }
      if (prev.sortOrder === 'desc') {
        return { sortBy: column, sortOrder: 'asc' }
      }
      return { sortBy: 'date', sortOrder: 'desc' }
    })
  }, [])

  /**
   * Toggles the expanded state of a transaction row
   */
  const toggleExpand = useCallback((txId) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(txId)) {
        next.delete(txId)
      } else {
        next.add(txId)
      }
      return next
    })
  }, [])

  /**
   * Handles quick period selection
   */
  const handleQuickPeriod = useCallback((value) => {
    setQuickPeriod(value)
    if (!value) {
      setFilters(prev => ({ ...prev, startDate: '', endDate: '' }))
      return
    }
    const { startDate, endDate } = getDatePeriod(value, userSettings?.weekStartDay ?? 1)
    setFilters(prev => ({ ...prev, startDate, endDate }))
  }, [userSettings?.weekStartDay])

  // Infinite scroll with IntersectionObserver
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current)
    }

    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // Flatten paginated transaction data
  const transactions = useMemo(() => data?.pages?.flatMap(page => page.data) || [], [data])
  const totalCount = data?.pages?.[0]?.pagination?.total || 0

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.getAll().then(r => r.data),
  })

  useEffect(() => {
    const requestedType = searchParams.get('new')
    if (!accountsData?.data || !['income', 'expense'].includes(requestedType)) return
    setDefaultType(requestedType)
    setEditingTx(null)
    setModalOpen(true)
  }, [accountsData?.data, searchParams])

  // Validate persisted account tab exists in loaded accounts
  useEffect(() => {
    if (accountsData?.data && accountTab) {
      const exists = accountsData.data.some(a => a.id === accountTab)
      if (!exists) {
        handleAccountTab('')
      }
    }
  }, [accountsData?.data, accountTab, handleAccountTab])

  const { data: categoriesData } = useQuery({
    queryKey: ['categories', { flat: true }],
    queryFn: () => categoriesApi.getAll({ flat: 'true' }).then(r => r.data.data.categories),
  })

  const { data: payeesData } = useQuery({
    queryKey: ['payees'],
    queryFn: () => payeesApi.getAll().then(r => r.data.data),
  })

  const { data: creditCardsData } = useQuery({
    queryKey: ['creditCards'],
    queryFn: () => creditCardsApi.getAll().then(r => r.data),
  })

  const createPayeeMutation = useMutation({
    mutationFn: payeesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payees'] })
    },
  })

  const handleCreatePayee = async (name) => {
    try {
      // Look up a known logo for this company
      const imageUrl = findKnownLogo(name)
      const result = await createPayeeMutation.mutateAsync({ name, imageUrl })
      return result.data.data
    } catch (err) {
      toast.error(translateError(err))
      return null
    }
  }

  const createCategoryMutation = useMutation({
    mutationFn: categoriesApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
    },
  })

  const handleCreateCategory = async (name, type) => {
    try {
      const result = await createCategoryMutation.mutateAsync({
        name,
        type: type || 'expense',
        icon: 'tag',
        color: '#6B7280'
      })
      return result.data.data.category
    } catch (err) {
      toast.error(translateError(err))
      return null
    }
  }

  const createMutation = useMutation({
    mutationFn: transactionsApi.create,
    onSuccess: () => {
      invalidateTransactionQueries()
      closeTransactionModal()
      toast.success(t('transactions.created'))
    },
    onError: (err) => {
      toast.error(translateError(err))
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => transactionsApi.update(id, data),
    onSuccess: () => {
      invalidateTransactionQueries()
      closeTransactionModal()
      toast.success(t('transactions.updated'))
    },
    onError: (err) => {
      toast.error(translateError(err))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: transactionsApi.delete,
    onSuccess: () => {
      invalidateTransactionQueries()
      toast.success(t('transactions.deleted'))
    },
    onError: (err) => {
      toast.error(translateError(err))
    },
  })

  /**
   * Mutation for toggling transaction reconciliation status
   * Uses optimistic update for better UX
   */
  const toggleReconcileMutation = useMutation({
    mutationFn: transactionsApi.toggleReconcile,
    onMutate: async (txId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['transactions'] })

      // Snapshot previous value
      const previousData = queryClient.getQueryData(['transactions', queryFilters, sort])

      // Optimistically update
      queryClient.setQueryData(['transactions', queryFilters, sort], (old) => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map(page => ({
            ...page,
            data: page.data.map(tx =>
              tx.id === txId
                ? { ...tx, isReconciled: !tx.isReconciled }
                : tx
            )
          }))
        }
      })

      return { previousData }
    },
    onError: (err, txId, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(['transactions', queryFilters, sort], context.previousData)
      }
      toast.error(translateError(err))
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })

  /**
   * Handles toggling reconciliation status for a transaction
   */
  const handleToggleReconcile = useCallback((tx) => {
    toggleReconcileMutation.mutate(tx.id)
  }, [toggleReconcileMutation])

  const handleSave = (formData) => {
    // Filter the data to send only the necessary fields
    const cleanData = {
      accountId: formData.accountId || null,
      categoryId: formData.categoryId || null,
      payeeId: formData.payeeId || null,
      amount: Math.abs(parseAmount(formData.amount)),
      description: formData.description,
      date: formData.date,
      type: formData.type,
    }

    // For transfers, add the destination account
    if (formData.type === 'transfer') {
      cleanData.toAccountId = formData.toAccountId || null
      cleanData.checkNumber = null
      cleanData.creditCardId = null
    } else {
      // Credit card and check number are mutually exclusive
      const creditCardId = formData.creditCardId && formData.creditCardId !== '__selecting__'
        ? formData.creditCardId : null
      const checkNumber = formData.checkNumber && formData.checkNumber !== '__selecting__'
        ? formData.checkNumber.trim() : null
      cleanData.creditCardId = creditCardId ? creditCardId : null
      cleanData.installmentCount = creditCardId ? Number(formData.installmentCount) || 1 : 1
      cleanData.checkNumber = creditCardId ? null : (checkNumber || null)
    }

    if (editingTx) {
      updateMutation.mutate({ id: editingTx.id, data: cleanData })
    } else {
      createMutation.mutate(cleanData)
    }
  }

  const handleEdit = useCallback((tx) => {
    let sourceAccountId = tx.accountId
    let destAccountId = tx.linkedAccountId || ''

    if (tx.type === 'transfer') {
      if (tx.amount > 0 && tx.linkedAccountId) {
        // Credit side of internal transfer: swap source and destination
        // tx.accountId is destination, tx.linkedAccountId is source
        sourceAccountId = tx.linkedAccountId
        destAccountId = tx.accountId
      } else if (tx.amount > 0 && !tx.linkedAccountId) {
        // External source transfer: no source, destination is tx.accountId
        sourceAccountId = ''
        destAccountId = tx.accountId
      }
      // For debit side (amount < 0): tx.accountId is source, tx.linkedAccountId is destination
      // This is the default case, no changes needed
    }

    setEditingTx({
      ...tx,
      amount: Math.abs(tx.amount),
      date: tx.date.split('T')[0],
      accountId: sourceAccountId,
      toAccountId: destAccountId,
      creditCardId: tx.creditCardId || '',
    })
    setModalOpen(true)
  }, [])

  const handleDelete = useCallback((tx) => setDeleteCandidate(tx), [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('transactions.title')}</h1>
          <p className="text-gray-600">
            {totalCount > 0 ? t('transactions.operationCount', { count: totalCount }) : t('transactions.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleReconcileMode}
            className={`btn flex items-center gap-2 ${
              reconcileMode
                ? 'bg-green-100 text-green-700 border-green-300 hover:bg-green-200'
                : 'btn-secondary'
            }`}
            title={t('transactions.reconciliation.title')}
          >
            <Scale className="w-5 h-5" />
            {reconcileMode ? t('transactions.reconciliation.exit') : t('transactions.reconciliation.title')}
          </button>
            {!reconcileMode && (
            <button onClick={() => { setDefaultType('expense'); setEditingTx(null); setModalOpen(true) }} className="btn btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              {t('transactions.newTransaction')}
            </button>
          )}
        </div>
      </div>

      <AccountTabs accounts={accountsData?.data} selected={accountTab} onSelect={handleAccountTab} />

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder={t('common.search')}
                aria-label={t('common.search')}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="input pl-10 pr-9"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput('')}
                  aria-label={t('transactions.filters.clearSearch')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
                  title={t('transactions.filters.clearSearch')}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          {/* Account dropdown only shown when "All accounts" tab is active */}
          {!accountTab && (
            <div className="w-48">
              <select
                aria-label={t('transactions.filters.allAccounts')}
                value={filters.accountId}
                onChange={(e) => setFilters({ ...filters, accountId: e.target.value })}
                className="input"
              >
                <option value="">{t('transactions.filters.allAccounts')}</option>
                {accountsData?.data?.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="w-48">
            <select
              aria-label={t('transactions.filters.allCategories')}
              value={filters.categoryId}
              onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}
              className="input"
            >
              <option value="">{t('transactions.filters.allCategories')}</option>
              {categoriesData?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="w-36">
            <select
              aria-label={t('transactions.filters.allTypes')}
              value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value })}
              className="input"
            >
              <option value="">{t('transactions.filters.allTypes')}</option>
              <option value="income">{t('transactions.filters.income')}</option>
              <option value="expense">{t('transactions.filters.expense')}</option>
              <option value="transfer">{t('transactions.filters.transfer')}</option>
            </select>
          </div>
          <div className="w-40">
            <select
              aria-label={t('transactions.filters.allStatuses')}
              value={filters.isReconciled}
              onChange={(e) => setFilters({ ...filters, isReconciled: e.target.value })}
              className="input"
            >
              <option value="">{t('transactions.filters.allStatuses')}</option>
              <option value="true">{t('transactions.filters.reconciled')}</option>
              <option value="false">{t('transactions.filters.notReconciled')}</option>
            </select>
          </div>
        </div>
        
        {/* Date filters */}
        <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t items-center">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-600">{t('transactions.filters.period')}</span>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="transaction-start-date" className="sr-only">{t('common.from', { defaultValue: 'De' })}</label>
            <input
              id="transaction-start-date"
              type="date"
              value={filters.startDate}
              onChange={(e) => {
                setFilters({ ...filters, startDate: e.target.value })
                setQuickPeriod('')
              }}
              className="input w-36 text-sm"
              placeholder="Du"
            />
            <span className="text-gray-400">→</span>
            <label htmlFor="transaction-end-date" className="sr-only">{t('common.to', { defaultValue: 'Até' })}</label>
            <input
              id="transaction-end-date"
              type="date"
              value={filters.endDate}
              onChange={(e) => {
                setFilters({ ...filters, endDate: e.target.value })
                setQuickPeriod('')
              }}
              className="input w-36 text-sm"
              min={filters.startDate}
              placeholder="Au"
            />
          </div>
          <select
            className="input w-40 text-sm"
            value={quickPeriod}
            onChange={(e) => handleQuickPeriod(e.target.value)}
          >
            <option value="">{t('transactions.filters.allDates')}</option>
            <option value="week">{t('transactions.filters.currentWeek')}</option>
            <option value="7days">{t('transactions.filters.last7days')}</option>
            <option value="month">{t('transactions.filters.currentMonth')}</option>
            <option value="30days">{t('transactions.filters.last30days')}</option>
            <option value="year">{t('transactions.filters.currentYear')}</option>
            <option value="365days">{t('transactions.filters.last365days')}</option>
          </select>
          {(filters.startDate || filters.endDate) && (
            <button
              onClick={() => {
                setFilters({ ...filters, startDate: '', endDate: '' })
                setQuickPeriod('')
              }}
              className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
            >
              <X className="w-4 h-4" />
              {t('common.clear')}
            </button>
          )}
          {hasActiveFilters && (
            <button
              onClick={resetAllFilters}
              className="ml-auto flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
              title={t('transactions.filters.resetAll')}
            >
              <RotateCcw className="w-4 h-4" />
              <span className="hidden sm:inline">{t('transactions.filters.resetAll')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Transactions list */}
      <div className="card p-0 overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full table-fixed">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-3 w-14"></th>
                    <th
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('date')}
                    >
                      <div className="flex items-center gap-1">
                        {t('common.date')}
                        <SortIcon column="date" sort={sort} />
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('description')}
                    >
                      <div className="flex items-center gap-1">
                        {t('common.description')}
                        <SortIcon column="description" sort={sort} />
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-40 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('payee')}
                    >
                      <div className="flex items-center gap-1">
                        {t('transactions.payee')}
                        <SortIcon column="payee" sort={sort} />
                      </div>
                    </th>
                    <th
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-40 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('category')}
                    >
                      <div className="flex items-center gap-1">
                        {t('transactions.category')}
                        <SortIcon column="category" sort={sort} />
                      </div>
                    </th>
                    {!accountTab && (
                    <th
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-36 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('account')}
                    >
                      <div className="flex items-center gap-1">
                        {t('transactions.account')}
                        <SortIcon column="account" sort={sort} />
                      </div>
                    </th>
                    )}
                    <th
                      className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase w-36 cursor-pointer hover:bg-gray-100 select-none"
                      onClick={() => handleSort('amount')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        {t('common.amount')}
                        <SortIcon column="amount" sort={sort} />
                      </div>
                    </th>
                    <th className="px-4 py-3 w-20"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {transactions.map((tx) => {
                    const expandable = hasExpandableDetails(tx)
                    return (
                    <Fragment key={tx.id}>
                      <tr
                        className={`group transition-colors ${
                          expandable ? 'cursor-pointer' : ''
                        } ${
                          tx.isReconciled
                            ? 'bg-green-50 hover:bg-green-100'
                            : 'hover:bg-gray-50'
                        }`}
                        onClick={(e) => {
                          if (expandable && !e.target.closest('button')) {
                            toggleExpand(tx.id)
                          }
                        }}
                      >
                        <td className="px-2 py-3">
                          <div className="flex items-center gap-1.5">
                            {expandable ? (
                              expandedRows.has(tx.id)
                                ? <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                : <ChevronRight className="w-4 h-4 text-gray-500 flex-shrink-0" />
                            ) : (
                              <span className="w-4 h-4 flex-shrink-0" />
                            )}
                            <TransactionTypeIcon type={tx.type} amount={tx.amount} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{formatDate(tx.date)}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{tx.description}</p>
                          {tx.installmentCount > 1 && (
                            <p className="text-xs text-gray-500">
                              {t('transactions.installments.position', {
                                current: tx.installmentNumber,
                                total: tx.installmentCount,
                                defaultValue: 'Parcela {{current}} de {{total}}',
                              })}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {tx.payeeName ? (
                            <div className="flex items-center gap-2">
                              {tx.payeeImageUrl ? (
                                <img
                                  src={tx.payeeImageUrl}
                                  alt={tx.payeeName}
                                  className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                                />
                              ) : (
                                <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                                  <Users className="w-3 h-3 text-gray-400" />
                                </div>
                              )}
                              <span>{tx.payeeName}</span>
                            </div>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {tx.categoryName ? (
                            <div className="flex items-center gap-2">
                              <CategoryIcon icon={tx.categoryIcon} color={tx.categoryColor} />
                              <span>{tx.categoryName}</span>
                            </div>
                          ) : '-'}
                        </td>
                        {!accountTab && (
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {tx.accountName}
                        </td>
                        )}
                        <td className={`px-4 py-3 text-right font-semibold ${tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {tx.amount >= 0 ? '+' : ''}{formatCurrency(tx.amount)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-center gap-1 h-7 items-center opacity-0 group-hover:opacity-100 transition-opacity">
                            {reconcileMode ? (
                              <button
                                onClick={() => handleToggleReconcile(tx)}
                                className={`p-1.5 rounded transition-colors ${
                                  tx.isReconciled
                                    ? 'text-green-600 hover:text-red-600 hover:bg-red-50'
                                    : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
                                }`}
                                title={tx.isReconciled ? t('transactions.reconciliation.unmarkReconciled') : t('transactions.reconciliation.markReconciled')}
                              >
                                <CheckCircle2 className={`w-4 h-4 ${tx.isReconciled ? 'fill-green-100' : ''}`} />
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => handleEdit(tx)}
                                  className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded"
                                >
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDelete(tx)}
                                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expandable && expandedRows.has(tx.id) && (
                        <TransactionExpandedRow tx={tx} colSpan={accountTab ? 7 : 8} />
                      )}
                    </Fragment>
                  )})}
                </tbody>
              </table>
            </div>

            {/* Infinite scroll trigger element */}
            <div ref={loadMoreRef} className="h-1" />

            {/* Loader de chargement */}
            {isFetchingNextPage && (
              <div className="flex justify-center py-4 border-t">
                <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
              </div>
            )}
          </>
        )}
      </div>

      {modalOpen && (
        <TransactionModal
          transaction={editingTx}
          accounts={accountsData?.data}
          categories={categoriesData}
          payees={payeesData}
          creditCards={creditCardsData?.data?.creditCards || []}
          defaultAccountId={accountTab}
          defaultType={defaultType}
          onClose={closeTransactionModal}
          onSave={handleSave}
          onCreatePayee={handleCreatePayee}
          onCreateCategory={handleCreateCategory}
          toast={toast}
        />
      )}

      {deleteCandidate && (
        <ConfirmModal
          variant="danger"
          title={t('common.delete')}
          message={t('transactions.confirmDelete', { description: deleteCandidate.description })}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          onConfirm={() => {
            deleteMutation.mutate(deleteCandidate.id)
            setDeleteCandidate(null)
          }}
          onClose={() => setDeleteCandidate(null)}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  )
}
