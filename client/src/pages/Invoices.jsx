/**
 * @fileoverview Faturas (PAINEL E2): cards summary, invoices per card,
 * purchases and refunds, payments with an account.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Plus, Trash2, Wallet } from 'lucide-react'
import { creditCardsApi, operationsApi, transactionsApi } from '../lib/api'
import { useFormatters } from '../hooks/useFormatters'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { translateError } from '../lib/errorHelper'
import {
  AccountSelect, AmountInput, CategorySelect, Field, FormModal, PageHeader, Stat, StatusBadge,
  amountOf, formError, todayISO, useAccounts, useCategories,
} from '../components/operations/kit'

/** 2026-10 → 10/2026 */
const competenceLabel = (competence) => `${competence.slice(5)}/${competence.slice(0, 4)}`

function PaymentModal({ invoice, accounts, onClose, onSaved }) {
  const { t } = useTranslation()
  const { formatCurrency } = useFormatters()
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState(String(invoice.pending).replace('.', ','))
  const [date, setDate] = useState(todayISO())

  const submit = async () => {
    const value = amountOf(amount)
    if (!value || value <= 0) throw formError(t('operations.amountRequired', { defaultValue: 'Informe um valor maior que zero.' }))
    await operationsApi.invoices.pay(invoice.id, { accountId, amount: value, date })
    onSaved()
  }

  return (
    <FormModal title={t('invoices.registerPayment', { defaultValue: 'Registrar pagamento' })} onClose={onClose} onSubmit={submit}>
      <p className="text-sm text-gray-600">
        {t('invoices.paymentHint', {
          defaultValue: 'Pendente: {{pending}}. O pagamento sai da conta escolhida e não conta como despesa; as compras já contam.',
          pending: formatCurrency(invoice.pending),
        })}
      </p>
      <Field label={t('invoices.payingAccount', { defaultValue: 'Conta debitada' })} htmlFor="pay-account">
        <AccountSelect id="pay-account" value={accountId} onChange={setAccountId} accounts={accounts} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('operations.amount', { defaultValue: 'Valor' })} htmlFor="pay-amount">
          <AmountInput id="pay-amount" value={amount} onChange={setAmount} required />
        </Field>
        <Field label={t('operations.date', { defaultValue: 'Data' })} htmlFor="pay-date">
          <input id="pay-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </Field>
      </div>
    </FormModal>
  )
}

/** UC-03: purchase (cash or in installments), refund or adjustment on the card. */
function CardTransactionModal({ cards, onClose, onSaved }) {
  const { t } = useTranslation()
  const { data: categories = [] } = useCategories('expense')
  const [cardId, setCardId] = useState(cards[0]?.id || '')
  const [kind, setKind] = useState('purchase')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [installments, setInstallments] = useState('1')
  const [categoryId, setCategoryId] = useState('')

  const submit = async () => {
    const card = cards.find((item) => item.id === cardId)
    const value = amountOf(amount)
    if (!card) throw formError(t('invoices.chooseCard', { defaultValue: 'Escolha o cartão.' }))
    if (!value || value <= 0) throw formError(t('operations.amountRequired', { defaultValue: 'Informe um valor maior que zero.' }))
    const isCredit = kind === 'refund' || kind === 'adjust_credit'
    await transactionsApi.create({
      accountId: card.accountId,
      creditCardId: card.id,
      type: isCredit ? 'income' : 'expense',
      amount: value,
      date,
      description,
      categoryId: categoryId || undefined,
      installmentCount: kind === 'purchase' ? Number(installments) || 1 : undefined,
      status: 'cleared',
    })
    onSaved()
  }

  return (
    <FormModal title={t('invoices.newTransaction', { defaultValue: 'Nova transação no cartão' })} onClose={onClose} onSubmit={submit}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('invoices.card', { defaultValue: 'Cartão' })} htmlFor="tx-card">
          <select id="tx-card" value={cardId} onChange={(e) => setCardId(e.target.value)} className="input" required>
            {cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
          </select>
        </Field>
        <Field label={t('invoices.kind', { defaultValue: 'Tipo' })} htmlFor="tx-kind">
          <select id="tx-kind" value={kind} onChange={(e) => setKind(e.target.value)} className="input">
            <option value="purchase">{t('invoices.purchase', { defaultValue: 'Compra' })}</option>
            <option value="refund">{t('invoices.refund', { defaultValue: 'Estorno' })}</option>
            <option value="adjust_debit">{t('invoices.adjustDebit', { defaultValue: 'Ajuste a débito' })}</option>
            <option value="adjust_credit">{t('invoices.adjustCredit', { defaultValue: 'Ajuste a crédito' })}</option>
          </select>
        </Field>
      </div>
      <Field label={t('operations.description', { defaultValue: 'Descrição' })} htmlFor="tx-description">
        <input id="tx-description" required value={description} onChange={(e) => setDescription(e.target.value)} className="input" />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t('operations.amount', { defaultValue: 'Valor' })} htmlFor="tx-amount">
          <AmountInput id="tx-amount" value={amount} onChange={setAmount} required />
        </Field>
        <Field label={t('operations.date', { defaultValue: 'Data' })} htmlFor="tx-date">
          <input id="tx-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="input" />
        </Field>
        {kind === 'purchase' && (
          <Field label={t('operations.installments', { defaultValue: 'Parcelas' })} htmlFor="tx-installments">
            <input id="tx-installments" type="number" min="1" max="36" value={installments} onChange={(e) => setInstallments(e.target.value)} className="input" />
          </Field>
        )}
      </div>
      <Field label={t('operations.category', { defaultValue: 'Categoria' })} htmlFor="tx-category">
        <CategorySelect id="tx-category" value={categoryId} onChange={setCategoryId} categories={categories} />
      </Field>
    </FormModal>
  )
}

function InvoiceRow({ invoice, onPay, onDeletePayment, canPay, canDelete }) {
  const { t } = useTranslation()
  const { formatCurrency, formatDate } = useFormatters()
  const [open, setOpen] = useState(false)
  const { data: detail } = useQuery({
    queryKey: ['invoice', invoice.id, invoice.total, invoice.paid],
    queryFn: () => operationsApi.invoices.get(invoice.id).then((r) => r.data.data.invoice),
    enabled: open,
  })

  return (
    <>
      <tr className="border-t hover:bg-gray-50">
        <td className="px-3 py-2">
          <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1 font-medium" aria-expanded={open}>
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            {invoice.cardName} · {competenceLabel(invoice.competence)}
          </button>
        </td>
        <td className="px-3 py-2 text-gray-600">{formatDate(invoice.dueDate)}</td>
        <td className="px-3 py-2 text-right">{formatCurrency(invoice.total)}</td>
        <td className="px-3 py-2 text-right text-green-700">{formatCurrency(invoice.paid)}</td>
        <td className="px-3 py-2 text-right font-semibold">{formatCurrency(invoice.pending)}</td>
        <td className="px-3 py-2"><StatusBadge status={invoice.status} /></td>
        <td className="px-3 py-2 text-right">
          {canPay && invoice.pending > 0 && (
            <button type="button" onClick={() => onPay(invoice)} className="btn btn-secondary btn-sm">
              {t('invoices.pay', { defaultValue: 'Pagar' })}
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-gray-50">
          <td colSpan={7} className="px-6 py-3 text-sm">
            {!detail ? t('common.loading') : (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <h3 className="font-medium mb-1">{t('invoices.transactions', { defaultValue: 'Transações' })}</h3>
                  {detail.transactions.length === 0 && <p className="text-gray-500">{t('invoices.noTransactions', { defaultValue: 'Nenhuma transação nesta fatura.' })}</p>}
                  <ul className="divide-y">
                    {detail.transactions.map((tx) => (
                      <li key={tx.id} className="flex justify-between py-1">
                        <span>
                          {formatDate(tx.purchaseDate || tx.date)} · {tx.description}
                          {tx.installmentCount ? ` (${tx.installmentNumber}/${tx.installmentCount})` : ''}
                        </span>
                        <span className={tx.amount > 0 ? 'text-green-700' : ''}>{formatCurrency(-tx.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="font-medium mb-1">{t('invoices.payments', { defaultValue: 'Pagamentos' })}</h3>
                  {detail.payments.length === 0 && <p className="text-gray-500">{t('invoices.noPayments', { defaultValue: 'Nenhum pagamento registrado.' })}</p>}
                  <ul className="divide-y">
                    {detail.payments.map((payment) => (
                      <li key={payment.id} className="flex items-center justify-between py-1">
                        <span>{formatDate(payment.date)} · {payment.accountName}</span>
                        <span className="flex items-center gap-2">
                          {formatCurrency(payment.amount)}
                          {canDelete && (
                            <button type="button" onClick={() => onDeletePayment(payment)} className="p-1 text-gray-400 hover:text-red-600"
                              aria-label={t('invoices.undoPayment', { defaultValue: 'Desfazer pagamento' })}>
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

export default function Invoices() {
  const { t } = useTranslation()
  const { formatCurrency } = useFormatters()
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [cardId, setCardId] = useState('')
  const [paying, setPaying] = useState(null)
  const [adding, setAdding] = useState(false)
  const { data: accounts = [] } = useAccounts()
  const { data: cards = [] } = useQuery({
    queryKey: ['credit-cards'],
    queryFn: () => creditCardsApi.getAll().then((r) => r.data.data.creditCards),
  })
  const { data: summary } = useQuery({
    queryKey: ['invoices', 'summary'],
    queryFn: () => operationsApi.invoices.summary().then((r) => r.data.data),
    enabled: can('financeiro.cartoes'),
  })
  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['invoices', cardId],
    queryFn: () => operationsApi.invoices.list({ cardId }).then((r) => r.data.data.invoices),
  })
  const deferredCards = cards.filter((card) => card.debitType === 'deferred')

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['invoices'] })
    queryClient.invalidateQueries({ queryKey: ['invoice'] })
    queryClient.invalidateQueries({ queryKey: ['accounts'] })
  }

  const deletePayment = async (payment) => {
    if (!window.confirm(t('invoices.confirmUndo', { defaultValue: 'Desfazer este pagamento? O movimento na conta será estornado.' }))) return
    try {
      await operationsApi.invoices.deletePayment(payment.id)
      refresh()
    } catch (err) {
      toast.error(translateError(err))
    }
  }

  // Latest due date first.
  const sorted = [...invoices].sort((a, b) => b.dueDate.localeCompare(a.dueDate))

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('invoices.title', { defaultValue: 'Faturas' })}
        subtitle={t('invoices.subtitle', { defaultValue: 'Compras e estornos formam a fatura; o pagamento só move dinheiro entre contas.' })}
      >
        {can('financeiro.faturas', 'lancar') && deferredCards.length > 0 && (
          <button type="button" onClick={() => setAdding(true)} className="btn btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> {t('invoices.newTransactionShort', { defaultValue: 'Nova transação' })}
          </button>
        )}
      </PageHeader>

      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t('invoices.limit', { defaultValue: 'Limite total' })} value={formatCurrency(summary.totals.limit)} />
          <Stat label={t('invoices.used', { defaultValue: 'Limite usado' })} value={formatCurrency(summary.totals.used)} />
          <Stat label={t('invoices.overdue', { defaultValue: 'Vencido' })} value={formatCurrency(summary.totals.overdue)} tone={summary.totals.overdue > 0 ? 'text-red-600' : undefined} />
          <Stat label={t('invoices.future', { defaultValue: 'Compromissos futuros' })} value={formatCurrency(summary.totals.futureTotal)} />
        </div>
      )}

      {summary?.cards?.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {summary.cards.map((card) => (
            <div key={card.id} className="card p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{card.name}</p>
                {card.currentInvoice && <StatusBadge status={card.currentInvoice.status} />}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-1 text-sm">
                <dt className="text-gray-500">{t('invoices.available', { defaultValue: 'Disponível' })}</dt>
                <dd className="text-right">{card.available === null ? '—' : formatCurrency(card.available)}</dd>
                <dt className="text-gray-500">{t('invoices.currentInvoice', { defaultValue: 'Fatura atual' })}</dt>
                <dd className="text-right">{card.currentInvoice ? formatCurrency(card.currentInvoice.total) : '—'}</dd>
                <dt className="text-gray-500">{t('invoices.future', { defaultValue: 'Compromissos futuros' })}</dt>
                <dd className="text-right">{formatCurrency(card.futureTotal)}</dd>
              </dl>
            </div>
          ))}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center gap-3 p-3 border-b">
          <label htmlFor="invoice-card" className="text-sm text-gray-600">{t('invoices.card', { defaultValue: 'Cartão' })}</label>
          <select id="invoice-card" value={cardId} onChange={(e) => setCardId(e.target.value)} className="input w-auto">
            <option value="">{t('operations.all', { defaultValue: 'Todos' })}</option>
            {deferredCards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
          </select>
        </div>
        {isLoading ? <p className="p-4 text-sm text-gray-500">{t('common.loading')}</p> : sorted.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Wallet className="mx-auto mb-2 w-8 h-8" />
            {t('invoices.empty', { defaultValue: 'Nenhuma fatura ainda. As faturas aparecem para cartões com débito diferido.' })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">{t('invoices.invoice', { defaultValue: 'Fatura' })}</th>
                  <th className="px-3 py-2">{t('invoices.dueDate', { defaultValue: 'Vencimento' })}</th>
                  <th className="px-3 py-2 text-right">{t('invoices.total', { defaultValue: 'Total' })}</th>
                  <th className="px-3 py-2 text-right">{t('invoices.paid', { defaultValue: 'Pago' })}</th>
                  <th className="px-3 py-2 text-right">{t('invoices.pending', { defaultValue: 'Pendente' })}</th>
                  <th className="px-3 py-2">{t('operations.statusLabel', { defaultValue: 'Situação' })}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((invoice) => (
                  <InvoiceRow
                    key={invoice.id}
                    invoice={invoice}
                    onPay={setPaying}
                    onDeletePayment={deletePayment}
                    canPay={can('financeiro.faturas', 'pagar')}
                    canDelete={can('financeiro.faturas', 'excluir')}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {paying && <PaymentModal invoice={paying} accounts={accounts} onClose={() => setPaying(null)} onSaved={refresh} />}
      {adding && <CardTransactionModal cards={deferredCards} onClose={() => setAdding(false)} onSaved={refresh} />}
    </div>
  )
}
