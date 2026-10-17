/**
 * @fileoverview Recorrências (PAINEL E5): bills of the month to pay, inside or
 * outside the accounts, and the series themselves (reajuste, encerrar).
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, Plus, Trash2, Undo2 } from 'lucide-react'
import { operationsApi } from '../lib/api'
import { useFormatters } from '../hooks/useFormatters'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { translateError } from '../lib/errorHelper'
import { cn } from '../lib/utils'
import {
  AccountSelect, AmountInput, CategorySelect, Field, FormModal, PageHeader, Stat, StatusBadge,
  amountOf, currentMonth, formError, todayISO, useAccounts, useCategories,
} from '../components/operations/kit'

function RecurrenceModal({ accounts, onClose, onSaved }) {
  const { t } = useTranslation()
  const { data: categories = [] } = useCategories('expense')
  const [form, setForm] = useState({
    name: '', creditor: '', amount: '', firstDueDate: todayISO(), openEnded: false, totalInstallments: '12',
    paidBeforeSystem: '0', defaultAccountId: '', categoryId: '', method: 'boleto',
  })
  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }))

  const submit = async () => {
    const amount = amountOf(form.amount)
    if (!amount || amount <= 0) throw formError(t('operations.amountRequired', { defaultValue: 'Informe um valor maior que zero.' }))
    await operationsApi.recurrences.create({
      name: form.name,
      creditor: form.creditor || null,
      amount,
      firstDueDate: form.firstDueDate,
      totalInstallments: form.openEnded ? null : Number(form.totalInstallments) || 1,
      paidBeforeSystem: Number(form.paidBeforeSystem) || 0,
      defaultAccountId: form.defaultAccountId || null,
      categoryId: form.categoryId || null,
      method: form.method || null,
    })
    onSaved()
  }

  return (
    <FormModal title={t('recurrences.new', { defaultValue: 'Nova recorrência' })} onClose={onClose} onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('recurrences.name', { defaultValue: 'Nome' })} htmlFor="rec-name">
          <input id="rec-name" required value={form.name} onChange={(e) => set('name')(e.target.value)} className="input" />
        </Field>
        <Field label={t('recurrences.creditor', { defaultValue: 'Credor' })} htmlFor="rec-creditor">
          <input id="rec-creditor" value={form.creditor} onChange={(e) => set('creditor')(e.target.value)} className="input" />
        </Field>
        <Field label={t('operations.amount', { defaultValue: 'Valor' })} htmlFor="rec-amount">
          <AmountInput id="rec-amount" value={form.amount} onChange={set('amount')} required />
        </Field>
        <Field label={t('recurrences.firstDue', { defaultValue: '1º vencimento' })} htmlFor="rec-first">
          <input id="rec-first" type="date" required value={form.firstDueDate} onChange={(e) => set('firstDueDate')(e.target.value)} className="input" />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.openEnded} onChange={(e) => set('openEnded')(e.target.checked)} />
        {t('recurrences.openEnded', { defaultValue: 'Sem prazo (aluguel, assinatura)' })}
      </label>
      <div className="grid grid-cols-2 gap-3">
        {!form.openEnded && (
          <Field label={t('recurrences.total', { defaultValue: 'Total de parcelas' })} htmlFor="rec-total">
            <input id="rec-total" type="number" min="1" max="600" value={form.totalInstallments} onChange={(e) => set('totalInstallments')(e.target.value)} className="input" />
          </Field>
        )}
        <Field
          label={t('recurrences.paidBefore', { defaultValue: 'Parcelas já pagas antes do sistema' })}
          htmlFor="rec-paid-before"
          hint={t('recurrences.paidBeforeHint', { defaultValue: 'Ficam no histórico, fora dos saldos e relatórios.' })}
        >
          <input id="rec-paid-before" type="number" min="0" max="600" value={form.paidBeforeSystem} onChange={(e) => set('paidBeforeSystem')(e.target.value)} className="input" />
        </Field>
        <Field label={t('recurrences.defaultAccount', { defaultValue: 'Conta padrão' })} htmlFor="rec-account">
          <AccountSelect id="rec-account" value={form.defaultAccountId} onChange={set('defaultAccountId')} accounts={accounts} allowEmpty emptyLabel={t('recurrences.none', { defaultValue: 'Nenhuma' })} />
        </Field>
        <Field label={t('operations.category', { defaultValue: 'Categoria' })} htmlFor="rec-category">
          <CategorySelect id="rec-category" value={form.categoryId} onChange={set('categoryId')} categories={categories} />
        </Field>
      </div>
    </FormModal>
  )
}

function PayModal({ bill, accounts, onClose, onSaved }) {
  const { t } = useTranslation()
  const [date, setDate] = useState(todayISO())
  const [amount, setAmount] = useState(String(bill.amount).replace('.', ','))
  const [accountId, setAccountId] = useState(bill.defaultAccountId || '')
  const [outside, setOutside] = useState(false)
  const submit = async () => {
    const value = amountOf(amount)
    if (!value || value <= 0) throw formError(t('operations.amountRequired', { defaultValue: 'Informe um valor maior que zero.' }))
    await operationsApi.recurrences.pay(bill.id, outside ? { date, amount: value, outsideAccounts: true } : { date, amount: value, accountId })
    onSaved()
  }
  return (
    <FormModal title={t('recurrences.payTitle', { defaultValue: 'Pagar {{name}}', name: bill.name })} onClose={onClose} onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('recurrences.paidDate', { defaultValue: 'Data do pagamento' })} htmlFor="pay-date">
          <input id="pay-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </Field>
        <Field label={t('recurrences.paidAmount', { defaultValue: 'Valor pago' })} htmlFor="pay-amount">
          <AmountInput id="pay-amount" value={amount} onChange={setAmount} required />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={outside} onChange={(e) => setOutside(e.target.checked)} />
        {t('recurrences.outside', { defaultValue: 'Pago fora das contas (lotérica, dinheiro): nenhum saldo muda' })}
      </label>
      {!outside && (
        <Field label={t('recurrences.payingAccount', { defaultValue: 'Conta debitada' })} htmlFor="pay-account">
          <AccountSelect id="pay-account" value={accountId} onChange={setAccountId} accounts={accounts} required />
        </Field>
      )}
    </FormModal>
  )
}

function AdjustModal({ recurrence, onClose, onSaved }) {
  const { t } = useTranslation()
  const [amount, setAmount] = useState('')
  const [fromNumber, setFromNumber] = useState(String(recurrence.nextDue?.number || 1))
  const submit = async () => {
    const value = amountOf(amount)
    if (!value || value <= 0) throw formError(t('operations.amountRequired', { defaultValue: 'Informe um valor maior que zero.' }))
    await operationsApi.recurrences.adjust(recurrence.id, { amount: value, fromNumber: Number(fromNumber) || undefined })
    onSaved()
  }
  return (
    <FormModal title={t('recurrences.adjust', { defaultValue: 'Reajustar parcelas em aberto' })} onClose={onClose} onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('recurrences.newAmount', { defaultValue: 'Novo valor' })} htmlFor="adjust-amount">
          <AmountInput id="adjust-amount" value={amount} onChange={setAmount} required />
        </Field>
        <Field label={t('recurrences.fromNumber', { defaultValue: 'A partir da parcela' })} htmlFor="adjust-from">
          <input id="adjust-from" type="number" min="1" value={fromNumber} onChange={(e) => setFromNumber(e.target.value)} className="input" />
        </Field>
      </div>
    </FormModal>
  )
}

function EndModal({ recurrence, onClose, onSaved }) {
  const { t } = useTranslation()
  const [endDate, setEndDate] = useState(todayISO())
  const submit = async () => {
    await operationsApi.recurrences.end(recurrence.id, { endDate })
    onSaved()
  }
  return (
    <FormModal title={t('recurrences.end', { defaultValue: 'Encerrar recorrência' })} onClose={onClose} onSubmit={submit}
      submitLabel={t('recurrences.endConfirm', { defaultValue: 'Encerrar' })}>
      <p className="text-sm text-gray-600">{t('recurrences.endHint', { defaultValue: 'Parcelas em aberto com vencimento depois desta data são removidas. As pagas ficam no histórico.' })}</p>
      <Field label={t('recurrences.endDate', { defaultValue: 'Encerrar em' })} htmlFor="end-date">
        <input id="end-date" type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input" />
      </Field>
    </FormModal>
  )
}

export default function Recurrences() {
  const { t } = useTranslation()
  const { formatCurrency, formatDate } = useFormatters()
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('month')
  const [month, setMonth] = useState(currentMonth())
  const [modal, setModal] = useState(null)
  const { data: accounts = [] } = useAccounts()
  const { data: bills, isLoading: billsLoading } = useQuery({
    queryKey: ['recurrences', 'month', month],
    queryFn: () => operationsApi.recurrences.month(month).then((r) => r.data.data),
    enabled: tab === 'month',
  })
  const { data: recurrences = [], isLoading: listLoading } = useQuery({
    queryKey: ['recurrences', 'list'],
    queryFn: () => operationsApi.recurrences.list().then((r) => r.data.data.recurrences),
    enabled: tab === 'list',
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['recurrences'] })
    queryClient.invalidateQueries({ queryKey: ['accounts'] })
  }
  const run = async (action) => {
    try {
      await action()
      refresh()
    } catch (err) {
      toast.error(translateError(err))
    }
  }
  const close = () => setModal(null)

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('recurrences.title', { defaultValue: 'Recorrências' })}
        subtitle={t('recurrences.subtitle', { defaultValue: 'Contas fixas e parceladas. Pagar com uma conta gera a saída; fora das contas não altera saldos.' })}
      >
        {can('financeiro.recorrencias', 'criar') && (
          <button type="button" onClick={() => setModal({ type: 'new' })} className="btn btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> {t('recurrences.new', { defaultValue: 'Nova recorrência' })}
          </button>
        )}
      </PageHeader>

      <div className="flex gap-2 border-b" role="tablist">
        {[['month', t('recurrences.monthTab', { defaultValue: 'Contas do mês' })], ['list', t('recurrences.listTab', { defaultValue: 'Cadastro' })]].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={cn('px-4 py-2 text-sm font-medium border-b-2 -mb-px', tab === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'month' && (
        <>
          <div className="flex items-center gap-3">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input w-auto" aria-label={t('operations.month', { defaultValue: 'Mês' })} />
          </div>
          {bills && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label={t('recurrences.due', { defaultValue: 'No mês' })} value={formatCurrency(bills.totals.due)} />
              <Stat label={t('recurrences.paid', { defaultValue: 'Pago' })} value={formatCurrency(bills.totals.paid)} tone="text-green-700" />
              <Stat label={t('recurrences.open', { defaultValue: 'Em aberto' })} value={formatCurrency(bills.totals.open)} />
              <Stat label={t('recurrences.overdue', { defaultValue: 'Vencido' })} value={formatCurrency(bills.totals.overdue)} tone={bills.totals.overdue > 0 ? 'text-red-600' : undefined} />
            </div>
          )}
          <div className="card overflow-hidden">
            {billsLoading || !bills ? <p className="p-4 text-sm text-gray-500">{t('common.loading')}</p> : bills.bills.length === 0 ? (
              <p className="p-8 text-center text-gray-500"><CalendarCheck className="mx-auto mb-2 w-8 h-8" />{t('recurrences.noBills', { defaultValue: 'Nenhuma conta neste mês.' })}</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">{t('recurrences.dueDate', { defaultValue: 'Vencimento' })}</th>
                    <th className="px-3 py-2">{t('recurrences.bill', { defaultValue: 'Conta' })}</th>
                    <th className="px-3 py-2 text-right">{t('operations.amount', { defaultValue: 'Valor' })}</th>
                    <th className="px-3 py-2">{t('operations.statusLabel', { defaultValue: 'Situação' })}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {bills.bills.map((bill) => (
                    <tr key={bill.id} className="border-t">
                      <td className="px-3 py-2 text-gray-600">{formatDate(bill.dueDate)}</td>
                      <td className="px-3 py-2">
                        <p className="font-medium">{bill.name} <span className="text-gray-500 font-normal">{bill.totalInstallments ? `${bill.number}/${bill.totalInstallments}` : ''}</span></p>
                        {bill.paid && (
                          <p className="text-xs text-gray-500">
                            {t('recurrences.paidOn', { defaultValue: 'Pago em {{date}}', date: formatDate(bill.paidDate) })}
                            {bill.outsideAccounts ? ` · ${t('recurrences.outsideShort', { defaultValue: 'fora das contas' })}` : ''}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{formatCurrency(bill.paid ? bill.paidAmount : bill.amount)}</td>
                      <td className="px-3 py-2"><StatusBadge status={bill.status} /></td>
                      <td className="px-3 py-2 text-right">
                        {can('financeiro.recorrencias', 'pagar') && !bill.paid && (
                          <button type="button" onClick={() => setModal({ type: 'pay', bill })} className="btn btn-secondary btn-sm">{t('recurrences.pay', { defaultValue: 'Pagar' })}</button>
                        )}
                        {can('financeiro.recorrencias', 'pagar') && bill.paid && (
                          <button type="button" onClick={() => run(() => operationsApi.recurrences.undoPayment(bill.id))} className="p-1 text-gray-400 hover:text-amber-600"
                            aria-label={t('recurrences.undoPayment', { defaultValue: 'Desfazer pagamento' })}>
                            <Undo2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === 'list' && (
        <div className="card overflow-hidden">
          {listLoading ? <p className="p-4 text-sm text-gray-500">{t('common.loading')}</p> : recurrences.length === 0 ? (
            <p className="p-8 text-center text-gray-500">{t('recurrences.empty', { defaultValue: 'Nenhuma recorrência cadastrada.' })}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">{t('recurrences.name', { defaultValue: 'Nome' })}</th>
                  <th className="px-3 py-2 text-right">{t('operations.amount', { defaultValue: 'Valor' })}</th>
                  <th className="px-3 py-2">{t('recurrences.progress', { defaultValue: 'Pagas' })}</th>
                  <th className="px-3 py-2 text-right">{t('recurrences.remaining', { defaultValue: 'Saldo devedor' })}</th>
                  <th className="px-3 py-2">{t('recurrences.next', { defaultValue: 'Próximo vencimento' })}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {recurrences.map((recurrence) => (
                  <tr key={recurrence.id} className="border-t">
                    <td className="px-3 py-2">
                      <p className="font-medium">{recurrence.name}</p>
                      <p className="text-xs text-gray-500">
                        {[recurrence.creditor, recurrence.endedAt ? t('recurrences.endedOn', { defaultValue: 'Encerrada em {{date}}', date: formatDate(recurrence.endedAt) }) : null].filter(Boolean).join(' · ')}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-right">{formatCurrency(recurrence.amount)}</td>
                    <td className="px-3 py-2">{recurrence.paidCount}/{recurrence.openEnded ? '∞' : recurrence.totalInstallments}</td>
                    <td className="px-3 py-2 text-right">{recurrence.remainingBalance === null ? '—' : formatCurrency(recurrence.remainingBalance)}</td>
                    <td className="px-3 py-2 text-gray-600">{recurrence.nextDue ? formatDate(recurrence.nextDue.dueDate) : '—'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap space-x-1">
                      {!recurrence.endedAt && can('financeiro.recorrencias', 'editar') && (
                        <button type="button" onClick={() => setModal({ type: 'adjust', recurrence })} className="btn btn-secondary btn-sm">{t('recurrences.adjustShort', { defaultValue: 'Reajustar' })}</button>
                      )}
                      {!recurrence.endedAt && can('financeiro.recorrencias', 'encerrar') && (
                        <button type="button" onClick={() => setModal({ type: 'end', recurrence })} className="btn btn-secondary btn-sm">{t('recurrences.endConfirm', { defaultValue: 'Encerrar' })}</button>
                      )}
                      {can('financeiro.recorrencias', 'excluir') && (
                        <button type="button" className="p-1 text-gray-400 hover:text-red-600" aria-label={t('common.delete')}
                          onClick={() => {
                            if (window.confirm(t('recurrences.confirmDelete', { defaultValue: 'Excluir a recorrência e estornar os pagamentos feitos com conta?' }))) {
                              run(() => operationsApi.recurrences.delete(recurrence.id))
                            }
                          }}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {modal?.type === 'new' && <RecurrenceModal accounts={accounts} onClose={close} onSaved={refresh} />}
      {modal?.type === 'pay' && <PayModal bill={modal.bill} accounts={accounts} onClose={close} onSaved={refresh} />}
      {modal?.type === 'adjust' && <AdjustModal recurrence={modal.recurrence} onClose={close} onSaved={refresh} />}
      {modal?.type === 'end' && <EndModal recurrence={modal.recurrence} onClose={close} onSaved={refresh} />}
    </div>
  )
}
