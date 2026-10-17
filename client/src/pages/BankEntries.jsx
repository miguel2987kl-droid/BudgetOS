/**
 * @fileoverview Entradas bancárias (PAINEL E4): entries per account, transfers
 * between own accounts, duplicate warning and the per-bank view.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRightLeft, Pencil, Plus, Trash2 } from 'lucide-react'
import { operationsApi } from '../lib/api'
import { useFormatters } from '../hooks/useFormatters'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { translateError } from '../lib/errorHelper'
import {
  AccountSelect, AmountInput, CategorySelect, Field, FormModal, PageHeader, Stat,
  amountOf, currentMonth, formError, monthRange, todayISO, useAccounts, useCategories,
} from '../components/operations/kit'

function EntryModal({ entry, accounts, onClose, onSaved }) {
  const { t } = useTranslation()
  const { formatCurrency, formatDate } = useFormatters()
  const { data: categories = [] } = useCategories('income')
  const [form, setForm] = useState({
    accountId: entry?.accountId || '',
    isTransfer: Boolean(entry?.originAccountId),
    originAccountId: entry?.originAccountId || '',
    description: entry?.description || '',
    payer: entry?.payer || '',
    document: entry?.document || '',
    amount: entry ? String(entry.amount).replace('.', ',') : '',
    date: entry?.date || todayISO(),
    method: entry?.method || 'pix',
    categoryId: entry?.categoryId || '',
  })
  const [duplicates, setDuplicates] = useState(null)
  const set = (key) => (value) => {
    setDuplicates(null)
    setForm((current) => ({ ...current, [key]: value }))
  }

  const submit = async () => {
    const amount = amountOf(form.amount)
    if (!amount || amount <= 0) throw formError(t('operations.amountRequired', { defaultValue: 'Informe um valor maior que zero.' }))
    const payload = {
      accountId: form.accountId,
      originAccountId: form.isTransfer ? form.originAccountId : null,
      description: form.description,
      payer: form.payer || null,
      document: form.document || null,
      amount,
      date: form.date,
      method: form.method || null,
      categoryId: form.isTransfer ? null : (form.categoryId || null),
      confirmDuplicate: Boolean(duplicates),
    }
    try {
      if (entry) await operationsApi.bankEntries.update(entry.id, payload)
      else await operationsApi.bankEntries.create(payload)
      onSaved()
    } catch (err) {
      const error = err?.response?.data?.error
      if (error?.code === 'POSSIBLE_DUPLICATE') {
        setDuplicates(error.details?.duplicates || [])
        throw formError(t('bankEntries.duplicateWarning', { defaultValue: 'Já existe um lançamento com a mesma conta, valor e data. Salve de novo para confirmar.' }))
      }
      throw err
    }
  }

  return (
    <FormModal
      title={entry ? t('bankEntries.edit', { defaultValue: 'Editar entrada' }) : t('bankEntries.new', { defaultValue: 'Nova entrada' })}
      onClose={onClose}
      onSubmit={submit}
      submitLabel={duplicates ? t('bankEntries.saveAnyway', { defaultValue: 'Salvar mesmo assim' }) : undefined}
    >
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.isTransfer} onChange={(e) => set('isTransfer')(e.target.checked)} />
        {t('bankEntries.isTransfer', { defaultValue: 'Transferência entre contas próprias (não conta como receita)' })}
      </label>
      <div className="grid grid-cols-2 gap-3">
        {form.isTransfer && (
          <Field label={t('bankEntries.origin', { defaultValue: 'Conta de origem' })} htmlFor="entry-origin">
            <AccountSelect id="entry-origin" value={form.originAccountId} onChange={set('originAccountId')} accounts={accounts.filter((a) => a.id !== form.accountId)} required />
          </Field>
        )}
        <Field label={t('bankEntries.account', { defaultValue: 'Conta que recebeu' })} htmlFor="entry-account">
          <AccountSelect id="entry-account" value={form.accountId} onChange={set('accountId')} accounts={accounts} required />
        </Field>
      </div>
      <Field label={t('operations.description', { defaultValue: 'Descrição' })} htmlFor="entry-description">
        <input id="entry-description" required value={form.description} onChange={(e) => set('description')(e.target.value)} className="input" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('bankEntries.payer', { defaultValue: 'Pagador' })} htmlFor="entry-payer">
          <input id="entry-payer" value={form.payer} onChange={(e) => set('payer')(e.target.value)} className="input" />
        </Field>
        <Field label={t('bankEntries.document', { defaultValue: 'Documento' })} htmlFor="entry-document">
          <input id="entry-document" value={form.document} onChange={(e) => set('document')(e.target.value)} className="input" />
        </Field>
        <Field label={t('operations.amount', { defaultValue: 'Valor' })} htmlFor="entry-amount">
          <AmountInput id="entry-amount" value={form.amount} onChange={set('amount')} required />
        </Field>
        <Field label={t('operations.date', { defaultValue: 'Data' })} htmlFor="entry-date">
          <input id="entry-date" type="date" required value={form.date} onChange={(e) => set('date')(e.target.value)} className="input" />
        </Field>
        <Field label={t('bankEntries.method', { defaultValue: 'Forma' })} htmlFor="entry-method">
          <select id="entry-method" value={form.method} onChange={(e) => set('method')(e.target.value)} className="input">
            <option value="pix">PIX</option>
            <option value="ted">TED</option>
            <option value="boleto">Boleto</option>
            <option value="deposito">{t('bankEntries.deposit', { defaultValue: 'Depósito' })}</option>
            <option value="outro">{t('bankEntries.other', { defaultValue: 'Outro' })}</option>
          </select>
        </Field>
        {!form.isTransfer && (
          <Field label={t('operations.category', { defaultValue: 'Categoria' })} htmlFor="entry-category">
            <CategorySelect id="entry-category" value={form.categoryId} onChange={set('categoryId')} categories={categories} />
          </Field>
        )}
      </div>
      {duplicates?.length > 0 && (
        <ul className="rounded bg-amber-50 p-3 text-sm text-amber-800">
          {duplicates.map((item) => <li key={item.id}>{formatDate(item.date)} · {item.description} · {formatCurrency(item.amount)}</li>)}
        </ul>
      )}
    </FormModal>
  )
}

export default function BankEntries() {
  const { t } = useTranslation()
  const { formatCurrency, formatDate } = useFormatters()
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [month, setMonth] = useState(currentMonth())
  const [accountId, setAccountId] = useState('')
  const [editing, setEditing] = useState(null)
  const { data: accounts = [] } = useAccounts()
  const { data, isLoading } = useQuery({
    queryKey: ['bank-entries', month, accountId],
    queryFn: () => operationsApi.bankEntries.list({ ...monthRange(month), accountId }).then((r) => r.data.data),
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['bank-entries'] })
    queryClient.invalidateQueries({ queryKey: ['accounts'] })
  }
  const remove = async (entry) => {
    if (!window.confirm(t('bankEntries.confirmDelete', { defaultValue: 'Excluir esta entrada? O movimento na conta será estornado.' }))) return
    try {
      await operationsApi.bankEntries.delete(entry.id)
      refresh()
    } catch (err) {
      toast.error(translateError(err))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('bankEntries.title', { defaultValue: 'Entradas bancárias' })}
        subtitle={t('bankEntries.subtitle', { defaultValue: 'O que entrou em cada conta. Transferências entre contas próprias não são receita.' })}
      >
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input w-auto" aria-label={t('operations.month', { defaultValue: 'Mês' })} />
        <AccountSelect id="entries-account" value={accountId} onChange={setAccountId} accounts={accounts} allowEmpty emptyLabel={t('operations.allAccounts', { defaultValue: 'Todas as contas' })} className="w-auto" />
        {can('financeiro.entradas', 'criar') && (
          <button type="button" onClick={() => setEditing({})} className="btn btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> {t('bankEntries.new', { defaultValue: 'Nova entrada' })}
          </button>
        )}
      </PageHeader>

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat label={t('bankEntries.totalEntries', { defaultValue: 'Entradas' })} value={formatCurrency(data.totals.entries)} tone="text-green-700" />
            <Stat label={t('bankEntries.totalTransfers', { defaultValue: 'Transferências recebidas' })} value={formatCurrency(data.totals.transfers)} />
          </div>
          {data.byBank.length > 0 && (
            <div className="grid gap-3 md:grid-cols-3">
              {data.byBank.map((bank) => (
                <div key={bank.accountId} className="card p-4">
                  <p className="font-semibold">{bank.accountName}</p>
                  {bank.institution && <p className="text-xs text-gray-500">{bank.institution}</p>}
                  <p className="mt-2 text-lg font-semibold text-green-700">{formatCurrency(bank.total)}</p>
                  <p className="text-xs text-gray-500">
                    {t('bankEntries.bankLine', { defaultValue: '{{count}} entradas · {{transfers}} em transferências', count: bank.entries, transfers: formatCurrency(bank.transfers) })}
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="card overflow-hidden">
        {isLoading ? <p className="p-4 text-sm text-gray-500">{t('common.loading')}</p> : data.entries.length === 0 ? (
          <p className="p-8 text-center text-gray-500">{t('bankEntries.empty', { defaultValue: 'Nenhuma entrada neste mês.' })}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">{t('operations.date', { defaultValue: 'Data' })}</th>
                  <th className="px-3 py-2">{t('operations.description', { defaultValue: 'Descrição' })}</th>
                  <th className="px-3 py-2">{t('bankEntries.account', { defaultValue: 'Conta que recebeu' })}</th>
                  <th className="px-3 py-2">{t('operations.category', { defaultValue: 'Categoria' })}</th>
                  <th className="px-3 py-2 text-right">{t('operations.amount', { defaultValue: 'Valor' })}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.entries.map((entry) => (
                  <tr key={entry.id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-600">{formatDate(entry.date)}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium">{entry.description}</p>
                      {entry.payer && <p className="text-xs text-gray-500">{entry.payer}</p>}
                    </td>
                    <td className="px-3 py-2">
                      {entry.isTransfer ? (
                        <span className="flex items-center gap-1"><ArrowRightLeft className="w-3 h-3" />{entry.originAccountName} → {entry.accountName}</span>
                      ) : entry.accountName}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{entry.isTransfer ? t('bankEntries.transfer', { defaultValue: 'Transferência' }) : (entry.categoryName || '—')}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatCurrency(entry.amount)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {can('financeiro.entradas', 'editar') && (
                        <button type="button" onClick={() => setEditing(entry)} className="p-1 text-gray-400 hover:text-primary-600" aria-label={t('common.edit')}>
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {can('financeiro.entradas', 'excluir') && (
                        <button type="button" onClick={() => remove(entry)} className="p-1 text-gray-400 hover:text-red-600" aria-label={t('common.delete')}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <EntryModal entry={editing.id ? editing : null} accounts={accounts} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
    </div>
  )
}
