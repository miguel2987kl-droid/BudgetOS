/**
 * @fileoverview Receitas (PAINEL E6): consolidated view of every revenue of
 * the period, and the cash and boleto revenues typed here.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, ChevronDown, ChevronRight, Plus, Trash2, Undo2 } from 'lucide-react'
import { operationsApi } from '../lib/api'
import { useFormatters } from '../hooks/useFormatters'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { translateError } from '../lib/errorHelper'
import {
  AccountSelect, AmountInput, CategorySelect, Field, FormModal, PageHeader, Stat, StatusBadge,
  amountOf, currentMonth, formError, monthRange, todayISO, useAccounts, useCategories,
} from '../components/operations/kit'

const SOURCE_LABELS = {
  cartao: 'Vendas no cartão',
  entrada: 'Entradas bancárias',
  boleto: 'Boletos',
  dinheiro: 'Dinheiro em espécie',
  outras: 'Outras',
}

function RevenueModal({ accounts, onClose, onSaved }) {
  const { t } = useTranslation()
  const { data: categories = [] } = useCategories('income')
  const [form, setForm] = useState({
    kind: 'boleto', description: '', customer: '', document: '', grossAmount: '', discount: '', fee: '',
    issueDate: todayISO(), firstDueDate: todayISO(), installmentCount: '1', categoryId: '',
    receivedNow: false, accountId: '',
  })
  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }))
  const isCash = form.kind === 'cash'

  const submit = async () => {
    const gross = amountOf(form.grossAmount)
    if (!gross || gross <= 0) throw formError(t('operations.amountRequired', { defaultValue: 'Informe um valor maior que zero.' }))
    const received = isCash || form.receivedNow
    await operationsApi.revenues.create({
      kind: form.kind,
      description: form.description,
      customer: form.customer || null,
      document: form.document || null,
      grossAmount: gross,
      discount: amountOf(form.discount) || 0,
      fee: amountOf(form.fee) || 0,
      issueDate: form.issueDate,
      firstDueDate: isCash ? form.issueDate : form.firstDueDate,
      installmentCount: isCash ? 1 : Number(form.installmentCount) || 1,
      categoryId: form.categoryId || null,
      receivedNow: received ? { date: form.issueDate, accountId: form.accountId || undefined } : undefined,
    })
    onSaved()
  }

  return (
    <FormModal title={t('revenues.new', { defaultValue: 'Adicionar entrada' })} onClose={onClose} onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('revenues.kind', { defaultValue: 'Tipo' })} htmlFor="rev-kind">
          <select id="rev-kind" value={form.kind} onChange={(e) => set('kind')(e.target.value)} className="input">
            <option value="boleto">{t('revenues.boleto', { defaultValue: 'Boleto' })}</option>
            <option value="cash">{t('revenues.cash', { defaultValue: 'Dinheiro em espécie' })}</option>
            <option value="other">{t('revenues.other', { defaultValue: 'Outra' })}</option>
          </select>
        </Field>
        <Field label={isCash ? t('operations.date', { defaultValue: 'Data' }) : t('revenues.issueDate', { defaultValue: 'Emissão' })} htmlFor="rev-issue">
          <input id="rev-issue" type="date" required value={form.issueDate} onChange={(e) => set('issueDate')(e.target.value)} className="input" />
        </Field>
      </div>
      <Field label={t('operations.description', { defaultValue: 'Descrição' })} htmlFor="rev-description">
        <input id="rev-description" required value={form.description} onChange={(e) => set('description')(e.target.value)} className="input" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('revenues.customer', { defaultValue: 'Cliente' })} htmlFor="rev-customer">
          <input id="rev-customer" value={form.customer} onChange={(e) => set('customer')(e.target.value)} className="input" />
        </Field>
        <Field label={t('revenues.document', { defaultValue: 'Documento' })} htmlFor="rev-document">
          <input id="rev-document" value={form.document} onChange={(e) => set('document')(e.target.value)} className="input" />
        </Field>
        <Field label={t('revenues.gross', { defaultValue: 'Valor bruto' })} htmlFor="rev-gross">
          <AmountInput id="rev-gross" value={form.grossAmount} onChange={set('grossAmount')} required />
        </Field>
        <Field label={t('revenues.discount', { defaultValue: 'Desconto' })} htmlFor="rev-discount">
          <AmountInput id="rev-discount" value={form.discount} onChange={set('discount')} />
        </Field>
        <Field label={t('revenues.fee', { defaultValue: 'Taxa' })} htmlFor="rev-fee">
          <AmountInput id="rev-fee" value={form.fee} onChange={set('fee')} />
        </Field>
        <Field label={t('operations.category', { defaultValue: 'Categoria' })} htmlFor="rev-category">
          <CategorySelect id="rev-category" value={form.categoryId} onChange={set('categoryId')} categories={categories} />
        </Field>
        {!isCash && (
          <>
            <Field label={t('revenues.firstDue', { defaultValue: 'Vencimento' })} htmlFor="rev-due">
              <input id="rev-due" type="date" required value={form.firstDueDate} onChange={(e) => set('firstDueDate')(e.target.value)} className="input" />
            </Field>
            <Field label={t('operations.installments', { defaultValue: 'Parcelas' })} htmlFor="rev-installments">
              <input id="rev-installments" type="number" min="1" max="120" value={form.installmentCount} onChange={(e) => set('installmentCount')(e.target.value)} className="input" />
            </Field>
          </>
        )}
      </div>
      {!isCash && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.receivedNow} onChange={(e) => set('receivedNow')(e.target.checked)} />
          {t('revenues.alreadyReceived', { defaultValue: 'Já recebido' })}
        </label>
      )}
      {(isCash || form.receivedNow) && (
        <Field
          label={t('revenues.account', { defaultValue: 'Conta (opcional)' })}
          htmlFor="rev-account"
          hint={t('revenues.accountHint', { defaultValue: 'Sem conta, a receita é registrada sem alterar saldos.' })}
        >
          <AccountSelect id="rev-account" value={form.accountId} onChange={set('accountId')} accounts={accounts} allowEmpty emptyLabel={t('revenues.noAccount', { defaultValue: 'Sem conta' })} />
        </Field>
      )}
    </FormModal>
  )
}

function ReceiveModal({ installment, accounts, onClose, onSaved }) {
  const { t } = useTranslation()
  const [date, setDate] = useState(todayISO())
  const [amount, setAmount] = useState(String(installment.amount).replace('.', ','))
  const [accountId, setAccountId] = useState('')
  const submit = async () => {
    const value = amountOf(amount)
    if (!value || value <= 0) throw formError(t('operations.amountRequired', { defaultValue: 'Informe um valor maior que zero.' }))
    await operationsApi.revenues.receive(installment.id, { date, amount: value, accountId: accountId || undefined })
    onSaved()
  }
  return (
    <FormModal title={t('revenues.receive', { defaultValue: 'Registrar recebimento' })} onClose={onClose} onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('revenues.receivedDate', { defaultValue: 'Data do recebimento' })} htmlFor="receive-date">
          <input id="receive-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </Field>
        <Field label={t('revenues.receivedAmount', { defaultValue: 'Valor recebido' })} htmlFor="receive-amount">
          <AmountInput id="receive-amount" value={amount} onChange={setAmount} required />
        </Field>
      </div>
      <Field label={t('revenues.account', { defaultValue: 'Conta (opcional)' })} htmlFor="receive-account"
        hint={t('revenues.accountHint', { defaultValue: 'Sem conta, a receita é registrada sem alterar saldos.' })}>
        <AccountSelect id="receive-account" value={accountId} onChange={setAccountId} accounts={accounts} allowEmpty emptyLabel={t('revenues.noAccount', { defaultValue: 'Sem conta' })} />
      </Field>
    </FormModal>
  )
}

export default function Revenues() {
  const { t } = useTranslation()
  const { formatCurrency, formatDate } = useFormatters()
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [month, setMonth] = useState(currentMonth())
  const [expanded, setExpanded] = useState(null)
  const [modal, setModal] = useState(null)
  const range = monthRange(month)
  const { data: accounts = [] } = useAccounts()
  const { data: consolidated } = useQuery({
    queryKey: ['revenues', 'consolidated', month],
    queryFn: () => operationsApi.revenues.consolidated(range).then((r) => r.data.data),
  })
  const { data: revenues = [], isLoading } = useQuery({
    queryKey: ['revenues', 'list', month],
    queryFn: () => operationsApi.revenues.list(range).then((r) => r.data.data.revenues),
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['revenues'] })
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

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('revenues.title', { defaultValue: 'Receitas' })}
        subtitle={t('revenues.subtitle', { defaultValue: 'Todas as entradas do mês. Vendas no cartão e entradas bancárias vêm das próprias telas; aqui se incluem boletos e dinheiro.' })}
      >
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input w-auto" aria-label={t('operations.month', { defaultValue: 'Mês' })} />
        {can('financeiro.receitas', 'criar') && (
          <button type="button" onClick={() => setModal({ type: 'new' })} className="btn btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> {t('revenues.new', { defaultValue: 'Adicionar entrada' })}
          </button>
        )}
      </PageHeader>

      {consolidated && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label={t('revenues.gross', { defaultValue: 'Valor bruto' })} value={formatCurrency(consolidated.totals.gross)} tone="text-green-700" />
            <Stat label={t('revenues.deductions', { defaultValue: 'Taxas e descontos' })} value={formatCurrency(consolidated.totals.deductions)} />
            <Stat label={t('revenues.net', { defaultValue: 'Líquido' })} value={formatCurrency(consolidated.totals.net)} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="card p-4">
              <h2 className="font-semibold mb-2">{t('revenues.bySource', { defaultValue: 'Por origem' })}</h2>
              <ul className="divide-y text-sm">
                {consolidated.bySource.map((row) => (
                  <li key={row.key} className="flex justify-between py-1">
                    <span>{t(`revenues.source.${row.key}`, { defaultValue: SOURCE_LABELS[row.key] || row.key })} ({row.count})</span>
                    <span>{formatCurrency(row.gross)}</span>
                  </li>
                ))}
                {consolidated.bySource.length === 0 && <li className="py-1 text-gray-500">{t('revenues.emptyMonth', { defaultValue: 'Nenhuma receita neste mês.' })}</li>}
              </ul>
            </div>
            <div className="card p-4">
              <h2 className="font-semibold mb-2">{t('revenues.byCategory', { defaultValue: 'Por categoria' })}</h2>
              <ul className="divide-y text-sm">
                {consolidated.byCategory.map((row) => (
                  <li key={row.key} className="flex justify-between py-1">
                    <span>{row.label || t('operations.noCategory', { defaultValue: 'Sem categoria' })}</span>
                    <span>{formatCurrency(row.gross)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {consolidated.items.length > 0 && (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">{t('operations.date', { defaultValue: 'Data' })}</th>
                    <th className="px-3 py-2">{t('revenues.origin', { defaultValue: 'Origem' })}</th>
                    <th className="px-3 py-2">{t('operations.description', { defaultValue: 'Descrição' })}</th>
                    <th className="px-3 py-2 text-right">{t('revenues.gross', { defaultValue: 'Valor bruto' })}</th>
                    <th className="px-3 py-2 text-right">{t('revenues.net', { defaultValue: 'Líquido' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {consolidated.items.map((item) => (
                    <tr key={`${item.sourceType}-${item.sourceId}`} className="border-t">
                      <td className="px-3 py-2 text-gray-600">{formatDate(item.date)}</td>
                      <td className="px-3 py-2">{t(`revenues.source.${item.source}`, { defaultValue: SOURCE_LABELS[item.source] })}</td>
                      <td className="px-3 py-2">{item.description}{item.customer ? ` · ${item.customer}` : ''}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(item.gross)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(item.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <div className="card overflow-hidden">
        <h2 className="p-3 border-b font-semibold">{t('revenues.typed', { defaultValue: 'Boletos e dinheiro' })}</h2>
        {isLoading ? <p className="p-4 text-sm text-gray-500">{t('common.loading')}</p> : revenues.length === 0 ? (
          <p className="p-6 text-center text-gray-500">{t('revenues.emptyTyped', { defaultValue: 'Nenhum boleto ou dinheiro neste mês.' })}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">{t('operations.description', { defaultValue: 'Descrição' })}</th>
                <th className="px-3 py-2">{t('revenues.issueDate', { defaultValue: 'Emissão' })}</th>
                <th className="px-3 py-2 text-right">{t('revenues.gross', { defaultValue: 'Valor bruto' })}</th>
                <th className="px-3 py-2 text-right">{t('revenues.receivable', { defaultValue: 'A receber' })}</th>
                <th className="px-3 py-2">{t('operations.statusLabel', { defaultValue: 'Situação' })}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {revenues.map((revenue) => (
                <RevenueRows
                  key={revenue.id}
                  revenue={revenue}
                  open={expanded === revenue.id}
                  onToggle={() => setExpanded(expanded === revenue.id ? null : revenue.id)}
                  onReceive={(installment) => setModal({ type: 'receive', installment })}
                  onUndo={(installment) => run(() => operationsApi.revenues.undoReceipt(installment.id))}
                  onCancel={() => {
                    if (window.confirm(t('revenues.confirmCancel', { defaultValue: 'Cancelar esta receita? O registro fica no histórico e os recebimentos em conta são estornados.' }))) {
                      run(() => operationsApi.revenues.cancel(revenue.id))
                    }
                  }}
                  onDelete={() => {
                    if (window.confirm(t('revenues.confirmDelete', { defaultValue: 'Excluir esta receita definitivamente?' }))) {
                      run(() => operationsApi.revenues.delete(revenue.id))
                    }
                  }}
                  can={can}
                  formatCurrency={formatCurrency}
                  formatDate={formatDate}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal?.type === 'new' && <RevenueModal accounts={accounts} onClose={() => setModal(null)} onSaved={refresh} />}
      {modal?.type === 'receive' && <ReceiveModal installment={modal.installment} accounts={accounts} onClose={() => setModal(null)} onSaved={refresh} />}
    </div>
  )
}

function RevenueRows({ revenue, open, onToggle, onReceive, onUndo, onCancel, onDelete, can, formatCurrency, formatDate }) {
  const { t } = useTranslation()
  const active = revenue.status !== 'cancelado'
  return (
    <>
      <tr className="border-t hover:bg-gray-50">
        <td className="px-3 py-2">
          <button type="button" onClick={onToggle} className="flex items-center gap-1 font-medium text-left" aria-expanded={open}>
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            {revenue.description}
            <span className="text-gray-500 font-normal">· {t(`revenues.kindLabel.${revenue.kind}`, { defaultValue: { boleto: 'Boleto', cash: 'Dinheiro', other: 'Outra' }[revenue.kind] })}</span>
          </button>
          {revenue.customer && <p className="pl-5 text-xs text-gray-500">{revenue.customer}</p>}
        </td>
        <td className="px-3 py-2 text-gray-600">{formatDate(revenue.issueDate)}</td>
        <td className="px-3 py-2 text-right">{formatCurrency(revenue.grossAmount)}</td>
        <td className="px-3 py-2 text-right">{formatCurrency(revenue.receivable)}</td>
        <td className="px-3 py-2"><StatusBadge status={revenue.status} /></td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          {active && can('financeiro.receitas', 'cancelar') && (
            <button type="button" onClick={onCancel} className="p-1 text-gray-400 hover:text-amber-600" aria-label={t('revenues.cancel', { defaultValue: 'Cancelar receita' })}>
              <Ban className="w-4 h-4" />
            </button>
          )}
          {can('financeiro.receitas', 'excluir') && (
            <button type="button" onClick={onDelete} className="p-1 text-gray-400 hover:text-red-600" aria-label={t('common.delete')}>
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </td>
      </tr>
      {open && revenue.installments.map((installment) => (
        <tr key={installment.id} className="bg-gray-50 text-gray-700">
          <td className="px-3 py-1 pl-10">{t('revenues.installment', { defaultValue: 'Parcela' })} {installment.number}/{revenue.installments.length}</td>
          <td className="px-3 py-1">{formatDate(installment.receivedDate || installment.dueDate)}</td>
          <td className="px-3 py-1 text-right">{formatCurrency(installment.receivedAmount ?? installment.amount)}</td>
          <td className="px-3 py-1" />
          <td className="px-3 py-1"><StatusBadge status={installment.status} /></td>
          <td className="px-3 py-1 text-right">
            {active && can('financeiro.receitas', 'editar') && !installment.received && (
              <button type="button" onClick={() => onReceive(installment)} className="btn btn-secondary btn-sm">{t('revenues.receiveShort', { defaultValue: 'Receber' })}</button>
            )}
            {active && can('financeiro.receitas', 'editar') && installment.received && (
              <button type="button" onClick={() => onUndo(installment)} className="p-1 text-gray-400 hover:text-amber-600" aria-label={t('revenues.undoReceipt', { defaultValue: 'Desfazer recebimento' })}>
                <Undo2 className="w-4 h-4" />
              </button>
            )}
          </td>
        </tr>
      ))}
    </>
  )
}
