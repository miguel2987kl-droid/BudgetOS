import { z } from 'zod';
import { REVENUE_KINDS } from '../services/revenueService.js';

/** Schemas for the PAINEL R2 operation records. */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)');
const month = z.string().regex(/^\d{4}-\d{2}$/, 'Invalid month format (YYYY-MM)');
const id = z.string().uuid('Invalid ID');
const positive = z.number().finite().positive('Amount must be positive');
const nonNegative = z.number().finite().min(0);
const text = (max) => z.string().trim().max(max);
const optionalText = (max) => text(max).nullable().optional();

export const idParamSchema = z.object({ id });

export const periodQuerySchema = z.object({
  from: date.optional(),
  to: date.optional(),
  accountId: id.optional(),
});

export const requiredPeriodQuerySchema = z.object({ from: date, to: date });

// Faturas
export const listInvoicesQuerySchema = z.object({
  cardId: id.optional(),
  competence: month.optional(),
});

export const invoicePaymentSchema = z.object({
  accountId: id,
  amount: positive,
  date,
});

// Vendas no cartão
const cardSaleFields = {
  customer: optionalText(200),
  kind: z.enum(['credit', 'debit']).default('credit'),
  brand: optionalText(40),
  acquirer: optionalText(60),
  grossAmount: positive,
  feeRate: z.number().min(0).max(100).default(0),
  discount: nonNegative.default(0),
  saleDate: date,
  installmentCount: z.number().int().min(1).max(36).default(1),
  creditDays: z.number().int().min(0).max(365).optional(),
  accountId: id,
  categoryId: id.nullable().optional(),
  document: optionalText(60),
  notes: optionalText(2000),
};

export const createCardSaleSchema = z.object({
  ...cardSaleFields,
  creditNow: z.boolean().optional(),
  creditDate: date.optional(),
});

export const updateCardSaleSchema = z.object({
  ...cardSaleFields,
  kind: cardSaleFields.kind.removeDefault(),
  feeRate: cardSaleFields.feeRate.removeDefault(),
  discount: cardSaleFields.discount.removeDefault(),
  installmentCount: cardSaleFields.installmentCount.removeDefault(),
}).partial();

export const listCardSalesQuerySchema = periodQuerySchema.extend({
  status: z.enum(['open', 'settled']).optional(),
});

export const creditInstallmentSchema = z.object({
  date,
  amount: positive.optional(),
  accountId: id.optional(),
});

// Entradas bancárias
const bankEntryFields = {
  accountId: id,
  originAccountId: id.nullable().optional(),
  description: text(500).min(1),
  payer: optionalText(200),
  document: optionalText(60),
  amount: positive,
  date,
  method: optionalText(30),
  categoryId: id.nullable().optional(),
  confirmDuplicate: z.boolean().optional(),
};

export const createBankEntrySchema = z.object(bankEntryFields).refine(
  (data) => data.accountId !== data.originAccountId,
  { message: 'Origin and destination must differ', path: ['originAccountId'] }
);

export const updateBankEntrySchema = z.object(bankEntryFields).partial();

export const listBankEntriesQuerySchema = periodQuerySchema.extend({
  includeTransfers: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
});

// Recorrências
export const createRecurrenceSchema = z.object({
  name: text(200).min(1),
  creditor: optionalText(200),
  categoryId: id.nullable().optional(),
  method: optionalText(30),
  amount: positive,
  firstDueDate: date,
  totalInstallments: z.number().int().min(1).max(600).nullable().optional(),
  defaultAccountId: id.nullable().optional(),
  notes: optionalText(2000),
  paidBeforeSystem: z.number().int().min(0).max(600).optional(),
});

export const updateRecurrenceSchema = z.object({
  name: text(200).min(1).optional(),
  creditor: optionalText(200),
  categoryId: id.nullable().optional(),
  method: optionalText(30),
  defaultAccountId: id.nullable().optional(),
  notes: optionalText(2000),
});

export const adjustRecurrenceSchema = z.object({
  amount: positive,
  fromNumber: z.number().int().min(1).optional(),
});

export const endRecurrenceSchema = z.object({ endDate: date.optional() });

export const listRecurrencesQuerySchema = z.object({
  status: z.enum(['active', 'ended']).optional(),
});

export const monthQuerySchema = z.object({ month });

export const payRecurrenceSchema = z.object({
  date,
  amount: positive.optional(),
  accountId: id.optional(),
  outsideAccounts: z.boolean().optional(),
}).refine((data) => data.outsideAccounts || data.accountId, {
  message: 'Choose the account or mark the payment as outside the accounts',
  path: ['accountId'],
});

// Receitas
const revenueFields = {
  kind: z.enum(REVENUE_KINDS),
  description: text(500).min(1),
  customer: optionalText(200),
  document: optionalText(60),
  categoryId: id.nullable().optional(),
  grossAmount: positive,
  discount: nonNegative.default(0),
  fee: nonNegative.default(0),
  issueDate: date,
  installmentCount: z.number().int().min(1).max(120).default(1),
  firstDueDate: date.optional(),
};

export const createRevenueSchema = z.object({
  ...revenueFields,
  receivedNow: z.object({ date: date.optional(), accountId: id.optional() }).optional(),
});

export const updateRevenueSchema = z.object({
  ...revenueFields,
  discount: revenueFields.discount.removeDefault(),
  fee: revenueFields.fee.removeDefault(),
  installmentCount: revenueFields.installmentCount.removeDefault(),
}).partial();

export const listRevenuesQuerySchema = periodQuerySchema.extend({
  kind: z.enum(REVENUE_KINDS).optional(),
  status: z.enum(['em_aberto', 'parcial', 'recebido', 'vencido', 'cancelado']).optional(),
});

export const receiveInstallmentSchema = z.object({
  date,
  amount: positive.optional(),
  accountId: id.optional(),
});
