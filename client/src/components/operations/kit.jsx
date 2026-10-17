/**
 * @fileoverview Shared pieces of the PAINEL operation pages (R2): the form
 * modal, amount input, status badge and the account/category lookups.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import Modal from '../Modal'
import { accountsApi, categoriesApi } from '../../lib/api'
import { parseAmount } from '../../hooks/useFormatters'
import { translateError } from '../../lib/errorHelper'
import { cn } from '../../lib/utils'

export const todayISO = () => new Date().toISOString().slice(0, 10)
export const currentMonth = () => todayISO().slice(0, 7)

export const monthRange = (month) => {
  const [year, value] = month.split('-').map(Number)
  const last = new Date(Date.UTC(year, value, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

/** Amount from a text field; returns null when empty or invalid. */
export const amountOf = (text) => {
  if (text === '' || text === null || text === undefined) return null
  const value = parseAmount(String(text))
  return Number.isFinite(value) ? value : null
}

export function useAccounts() {
  return useQuery({
    // Own key: other pages cache the whole list response under ['accounts'].
    queryKey: ['accounts', 'operations-list'],
    queryFn: () => accountsApi.getAll().then((r) => r.data.data),
  })
}

export function useCategories(type) {
  return useQuery({
    queryKey: ['categories', { flat: true }],
    queryFn: () => categoriesApi.getAll({ flat: true }).then((r) => r.data.data.categories),
    select: (categories) => (type ? categories.filter((category) => category.type === type) : categories),
  })
}

const STATUS_STYLES = {
  aberta: 'bg-blue-100 text-blue-700',
  fechada: 'bg-amber-100 text-amber-700',
  parcial: 'bg-indigo-100 text-indigo-700',
  paga: 'bg-green-100 text-green-700',
  pago: 'bg-green-100 text-green-700',
  vencida: 'bg-red-100 text-red-700',
  vencido: 'bg-red-100 text-red-700',
  atrasado: 'bg-red-100 text-red-700',
  previsto: 'bg-blue-100 text-blue-700',
  creditado: 'bg-green-100 text-green-700',
  em_aberto: 'bg-blue-100 text-blue-700',
  recebido: 'bg-green-100 text-green-700',
  cancelado: 'bg-gray-200 text-gray-600',
}

export function StatusBadge({ status }) {
  const { t } = useTranslation()
  const labels = {
    aberta: 'Aberta', fechada: 'Fechada', parcial: 'Parcial', paga: 'Paga', pago: 'Pago', vencida: 'Vencida',
    vencido: 'Vencido', atrasado: 'Atrasado', previsto: 'Previsto', creditado: 'Creditado', em_aberto: 'Em aberto',
    recebido: 'Recebido', cancelado: 'Cancelado',
  }
  return (
    <span className={cn('badge whitespace-nowrap', STATUS_STYLES[status] || 'bg-gray-100 text-gray-700')}>
      {t(`operations.status.${status}`, { defaultValue: labels[status] || status })}
    </span>
  )
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-600">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export function Stat({ label, value, tone = 'text-gray-900' }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className={cn('mt-1 text-lg font-semibold', tone)}>{value}</p>
    </div>
  )
}

export function Field({ label, htmlFor, hint, children, className }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

/** Plain text amount so the user's own decimal separator works. */
export function AmountInput({ id, value, onChange, required = false, placeholder = '0,00' }) {
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      required={required}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="input text-right"
    />
  )
}

export function AccountSelect({ id, value, onChange, accounts = [], allowEmpty = false, emptyLabel, required = false, className = '' }) {
  const { t } = useTranslation()
  return (
    <select id={id} value={value || ''} onChange={(event) => onChange(event.target.value)} className={cn('input', className)} required={required}>
      {(allowEmpty || !value) && <option value="">{emptyLabel || t('operations.chooseAccount', { defaultValue: 'Escolha a conta' })}</option>}
      {accounts.filter((account) => account.isActive !== false).map((account) => (
        <option key={account.id} value={account.id}>{account.name}</option>
      ))}
    </select>
  )
}

export function CategorySelect({ id, value, onChange, categories = [] }) {
  const { t } = useTranslation()
  return (
    <select id={id} value={value || ''} onChange={(event) => onChange(event.target.value)} className="input">
      <option value="">{t('operations.noCategory', { defaultValue: 'Sem categoria' })}</option>
      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
    </select>
  )
}

/**
 * Modal with a form, a submit button and the API error. `onSubmit` returns a
 * promise; the modal closes when it resolves.
 */
export function FormModal({ title, onClose, onSubmit, submitLabel, children, wide = false }) {
  const { t } = useTranslation()
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const titleId = `form-${title.replace(/\W+/g, '-').toLowerCase()}`

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setPending(true)
    try {
      await onSubmit()
      onClose()
    } catch (err) {
      setError(err?.isValidation ? err.message : translateError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className={cn('bg-white rounded-xl w-full', wide ? 'max-w-2xl' : 'max-w-lg')} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="flex items-center justify-between p-4 border-b">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 rounded" aria-label={t('common.close', { defaultValue: 'Fechar' })}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
          {children}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn btn-secondary flex-1">{t('common.cancel')}</button>
            <button type="submit" disabled={pending} className="btn btn-primary flex-1 disabled:opacity-60">
              {pending ? t('common.saving', { defaultValue: 'Salvando...' }) : (submitLabel || t('common.save'))}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}

/** A validation message shown in a FormModal without calling the API. */
export const formError = (message) => Object.assign(new Error(message), { isValidation: true })
