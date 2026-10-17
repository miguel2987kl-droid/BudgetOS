/**
 * @fileoverview Vendas no cartão (PAINEL E3): sale with fee and installments,
 * expected credits, credit and undo, indicators.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Plus, Trash2, Undo2 } from 'lucide-react'
import { operationsApi } from '../lib/api'
import { useFormatters } from '../hooks/useFormatters'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { translateError } from '../lib/errorHelper'
import {
  AccountSelect, AmountInput, CategorySelect, Field, FormModal, PageHeader, Stat, StatusBadge,
  amountOf, currentMonth, formError, monthRange, todayISO, useAccounts, useCategories,
} from '../components/operations/kit'

function SaleModal({ accounts, onClose, onSaved }) {
  const { t } = useTranslation()
  const { formatCurrency } = useFormatters()
  const { data: categories = [] } = useCategories('income')
  const [form, setForm] = useState({
    customer: '', kind: 'credit', brand: '', acquirer: '', grossAmount: '', feeRate: '', discount: '',
    saleDate: todayISO(), installmentCount: '1', creditDays: '30', accountId: '', categoryId: '', document: '', creditNow: false,
  })
  const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }))
  const gross = amountOf(form.grossAmount) || 0
  const fee = Math.round(gross * (amountOf(form.feeRate) || 0)) / 100
  const net = gross - fee - (amountOf(form.discount) || 0)
  const count = form.kind === 'debit' ? 1 : Math.max(1, Number(form.installmentCount) || 1)

  const submit = async () => {
    if (!(gross > 0)) throw formError(t('operations.amountRequired', { defaultValue: 'Informe um valor maior que zero.' }))
    await operationsApi.cardSales.create({
      customer: form.customer || null,
      kind: form.kind,
      brand: form.brand || null,
      acquirer: form.acquirer || null,
      grossAmount: gross,
      feeRate: amountOf(form.feeRate) || 0,
      discount: amountOf(form.discount) || 0,
      saleDate: form.saleDate,
      installmentCount: count,
      creditDays: Number(form.creditDays) || 0,
      accountId: form.accountId,
      categoryId: form.categoryId || null,
      document: form.document || null,
      creditNow: form.creditNow,
    })
    onSaved()
  }

  return (
    <FormModal title={t('cardSales.new', { defaultValue: 'Nova venda no cartão' })} onClose={onClose} onSubmit={submit} wide>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Field label={t('cardSales.customer', { defaultValue: 'Cliente' })} htmlFor="sale-customer" className="md:col-span-2">
          <input id="sale-customer" value={form.customer} onChange={(e) => set('customer')(e.target.value)} className="input" />
        </Field>
        <Field label={t('cardSales.kind', { defaultValue: 'Modalidade' })} htmlFor="sale-kind">
          <select id="sale-kind" value={form.kind} onChange={(e) => set('kind')(e.target.value)} className="input">
            <option value="credit">{t('cardSales.credit', { defaultValue: 'Crédito' })}</option>
            <option value="debit">{t('cardSales.debit', { defaultValue: 'Débito' })}</option>
          </select>
        </Field>
        <Field label={t('cardSales.brand', { defaultValue: 'Bandeira' })} htmlFor="sale-brand">
          <input id="sale-brand" value={form.brand} onChange={(e) => set('brand')(e.target.value)} className="input" placeholder="Visa" />
        </Field>
        <Field label={t('cardSales.acquirer', { defaultValue: 'Operadora' })} htmlFor="sale-acquirer">
          <input id="sale-acquirer" value={form.acquirer} onChange={(e) => set('acquirer')(e.target.value)} className="input" placeholder="Stone" />
        </Field>
        <Field label={t('cardSales.document', { defaultValue: 'Documento' })} htmlFor="sale-document">
          <input id="sale-document" value={form.document} onChange={(e) => set('document')(e.target.value)} className="input" />
        </Field>
        <Field label={t('cardSales.gross', { defaultValue: 'Valor bruto' })} htmlFor="sale-gross">
          <AmountInput id="sale-gross" value={form.grossAmount} onChange={set('grossAmount')} required />
        </Field>
        <Field label={t('cardSales.feeRate', { defaultValue: 'Taxa (%)' })} htmlFor="sale-fee">
          <AmountInput id="sale-fee" value={form.feeRate} onChange={set('feeRate')} placeholder="0" />
        </Field>
        <Field label={t('cardSales.discount', { defaultValue: 'Desconto' })} htmlFor="sale-discount">
          <AmountInput id="sale-discount" value={form.discount} onChange={set('discount')} />
        </Field>
        <Field label={t('cardSales.saleDate', { defaultValue: 'Data da venda' })} htmlFor="sale-date">
          <input id="sale-date" type="date" required value={form.saleDate} onChange={(e) => set('saleDate')(e.target.value)} className="input" />
        </Field>
        {form.kind === 'credit' && (
          <Field label={t('operations.installments', { defaultValue: 'Parcelas' })} htmlFor="sale-installments">
            <input id="sale-installments" type="number" min="1" max="36" value={form.installmentCount} onChange={(e) => set('installmentCount')(e.target.value)} className="input" />
          </Field>
        )}
        <Field label={t('cardSales.creditDays', { defaultValue: 'Dias até o crédito' })} htmlFor="sale-days">
          <input id="sale-days" type="number" min="0" max="365" value={form.creditDays} onChange={(e) => set('creditDays')(e.target.value)} className="input" />
        </Field>
        <Field label={t('cardSales.account', { defaultValue: 'Conta de crédito' })} htmlFor="sale-account">
          <AccountSelect id="sale-account" value={form.accountId} onChange={set('accountId')} accounts={accounts} required />
        </Field>
        <Field label={t('operations.category', { defaultValue: 'Categoria' })} htmlFor="sale-category">
          <CategorySelect id="sale-category" value={form.categoryId} onChange={set('categoryId')} categories={categories} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.creditNow} onChange={(e) => set('creditNow')(e.target.checked)} />
        {t('cardSales.creditNow', { defaultValue: 'Já creditada integralmente (débito ou antecipação)' })}
      </label>
      <p className="rounded bg-gray-50 p-3 text-sm text-gray-700">
        {t('cardSales.preview', {
          defaultValue: 'Taxa {{fee}} · líquido {{net}} · {{count}}x de {{installment}}. A receita conta uma vez, pelo bruto, na data da venda.',
          fee: formatCurrency(fee), net: formatCurrency(Math.max(net, 0)), count, installment: formatCurrency(Math.max(net, 0) / count),
        })}
      </p>
    </FormModal>
  )
}

function CreditModal({ installment, sale, accounts, onClose, onSaved }) {
  const { t } = useTranslation()
  const [date, setDate] = useState(installment.expectedDate <= todayISO() ? installment.expectedDate : todayISO())
  const [amount, setAmount] = useState(String(installment.amount).replace('.', ','))
  const [accountId, setAccountId] = useState(installment.accountId || sale.accountId || '')
  const submit = async () => {
    await operationsApi.cardSales.credit(installment.id, { date, amount: amountOf(amount), accountId })
    onSaved()
  }
  return (
    <FormModal title={t('cardSales.markCredited', { defaultValue: 'Marcar como creditado' })} onClose={onClose} onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('operations.date', { defaultValue: 'Data' })} htmlFor="credit-date">
          <input id="credit-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </Field>
        <Field label={t('operations.amount', { defaultValue: 'Valor' })} htmlFor="credit-amount">
          <AmountInput id="credit-amount" value={amount} onChange={setAmount} required />
        </Field>
      </div>
      <Field label={t('cardSales.account', { defaultValue: 'Conta de crédito' })} htmlFor="credit-account">
        <AccountSelect id="credit-account" value={accountId} onChange={setAccountId} accounts={accounts} required />
      </Field>
    </FormModal>
  )
}

export default function CardSales() {
  const { t } = useTranslation()
  const { formatCurrency, formatDate } = useFormatters()
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [month, setMonth] = useState(currentMonth())
  const [expanded, setExpanded] = useState(null)
  const [creating, setCreating] = useState(false)
  const [crediting, setCrediting] = useState(null)
  const { data: accounts = [] } = useAccounts()
  const { data, isLoading } = useQuery({
    queryKey: ['card-sales', month],
    queryFn: () => operationsApi.cardSales.list(monthRange(month)).then((r) => r.data.data),
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['card-sales'] })
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

  const indicators = data?.indicators

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('cardSales.title', { defaultValue: 'Vendas no cartão' })}
        subtitle={t('cardSales.subtitle', { defaultValue: 'Cada parcela é um valor a receber pelo líquido; o crédito só liquida, não é nova receita.' })}
      >
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="input w-auto" aria-label={t('operations.month', { defaultValue: 'Mês' })} />
        {can('financeiro.vendas_cartao', 'criar') && (
          <button type="button" onClick={() => setCreating(true)} className="btn btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> {t('cardSales.newShort', { defaultValue: 'Nova venda' })}
          </button>
        )}
      </PageHeader>

      {indicators && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Stat label={t('cardSales.gross', { defaultValue: 'Valor bruto' })} value={formatCurrency(indicators.gross)} />
          <Stat label={t('cardSales.fees', { defaultValue: 'Taxas' })} value={formatCurrency(indicators.fees)} />
          <Stat label={t('cardSales.net', { defaultValue: 'Líquido' })} value={formatCurrency(indicators.net)} />
          <Stat label={t('cardSales.received', { defaultValue: 'Recebido' })} value={formatCurrency(indicators.received)} tone="text-green-700" />
          <Stat label={t('cardSales.receivable', { defaultValue: 'A receber' })} value={formatCurrency(indicators.receivable)} />
          <Stat label={t('cardSales.overdue', { defaultValue: 'Atrasado' })} value={formatCurrency(indicators.overdue)} tone={indicators.overdue > 0 ? 'text-red-600' : undefined} />
        </div>
      )}

      <div className="card overflow-hidden">
        {isLoading ? <p className="p-4 text-sm text-gray-500">{t('common.loading')}</p> : data.sales.length === 0 ? (
          <p className="p-8 text-center text-gray-500">{t('cardSales.empty', { defaultValue: 'Nenhuma venda neste mês.' })}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">{t('cardSales.sale', { defaultValue: 'Venda' })}</th>
                  <th className="px-3 py-2">{t('cardSales.saleDate', { defaultValue: 'Data da venda' })}</th>
                  <th className="px-3 py-2 text-right">{t('cardSales.gross', { defaultValue: 'Valor bruto' })}</th>
                  <th className="px-3 py-2 text-right">{t('cardSales.net', { defaultValue: 'Líquido' })}</th>
                  <th className="px-3 py-2 text-right">{t('cardSales.receivable', { defaultValue: 'A receber' })}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {data.sales.map((sale) => (
                  <SaleRows
                    key={sale.id}
                    sale={sale}
                    open={expanded === sale.id}
                    onToggle={() => setExpanded(expanded === sale.id ? null : sale.id)}
                    onCredit={(installment) => setCrediting({ installment, sale })}
                    onUndo={(installment) => run(() => operationsApi.cardSales.undoCredit(installment.id))}
                    onDelete={() => {
                      if (window.confirm(t('cardSales.confirmDelete', { defaultValue: 'Excluir esta venda e estornar os créditos já lançados?' }))) {
                        run(() => operationsApi.cardSales.delete(sale.id))
                      }
                    }}
                    canCredit={can('financeiro.vendas_cartao', 'creditar')}
                    canDelete={can('financeiro.vendas_cartao', 'excluir')}
                    formatCurrency={formatCurrency}
                    formatDate={formatDate}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && <SaleModal accounts={accounts} onClose={() => setCreating(false)} onSaved={refresh} />}
      {crediting && <CreditModal {...crediting} accounts={accounts} onClose={() => setCrediting(null)} onSaved={refresh} />}
    </div>
  )
}

function SaleRows({ sale, open, onToggle, onCredit, onUndo, onDelete, canCredit, canDelete, formatCurrency, formatDate }) {
  const { t } = useTranslation()
  return (
    <>
      <tr className="border-t hover:bg-gray-50">
        <td className="px-3 py-2">
          <button type="button" onClick={onToggle} className="flex items-center gap-1 font-medium text-left" aria-expanded={open}>
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            {sale.customer || t('cardSales.noCustomer', { defaultValue: 'Sem cliente' })}
            <span className="text-gray-500 font-normal">· {[sale.brand, `${sale.installmentCount}x`].filter(Boolean).join(' ')}</span>
          </button>
        </td>
        <td className="px-3 py-2 text-gray-600">{formatDate(sale.saleDate)}</td>
        <td className="px-3 py-2 text-right">{formatCurrency(sale.grossAmount)}</td>
        <td className="px-3 py-2 text-right">{formatCurrency(sale.netAmount)}</td>
        <td className="px-3 py-2 text-right font-semibold">{formatCurrency(sale.receivable)}</td>
        <td className="px-3 py-2 text-right">
          {canDelete && (
            <button type="button" onClick={onDelete} className="p-1 text-gray-400 hover:text-red-600" aria-label={t('common.delete')}>
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </td>
      </tr>
      {open && sale.installments.map((installment) => (
        <tr key={installment.id} className="bg-gray-50 text-gray-700">
          <td className="px-3 py-1 pl-10">{t('cardSales.installment', { defaultValue: 'Parcela' })} {installment.number}/{sale.installmentCount}</td>
          <td className="px-3 py-1">{formatDate(installment.creditedDate || installment.expectedDate)}</td>
          <td className="px-3 py-1" />
          <td className="px-3 py-1 text-right">{formatCurrency(installment.creditedAmount ?? installment.amount)}</td>
          <td className="px-3 py-1 text-right"><StatusBadge status={installment.status} /></td>
          <td className="px-3 py-1 text-right">
            {canCredit && !installment.credited && (
              <button type="button" onClick={() => onCredit(installment)} className="btn btn-secondary btn-sm">
                {t('cardSales.credited', { defaultValue: 'Creditado' })}
              </button>
            )}
            {canCredit && installment.credited && (
              <button type="button" onClick={() => onUndo(installment)} className="p-1 text-gray-400 hover:text-amber-600" aria-label={t('cardSales.undoCredit', { defaultValue: 'Desfazer crédito' })}>
                <Undo2 className="w-4 h-4" />
              </button>
            )}
          </td>
        </tr>
      ))}
    </>
  )
}
