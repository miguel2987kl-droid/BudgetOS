import { z } from 'zod';

/**
 * Valid account types
 */
export const accountTypes = ['checking', 'savings', 'cash', 'investment', 'external', 'credit_card'];

/**
 * Account creation schema
 */
export const createAccountSchema = z.object({
  name: z
    .string()
    .min(1, 'Name required')
    .max(100, 'Name too long')
    .trim(),
  type: z.enum(accountTypes, {
    errorMap: () => ({ message: 'Invalid account type' }),
  }),
  institution: z
    .string()
    .max(100, 'Institution name too long')
    .trim()
    .optional(),
  accountNumber: z
    .string()
    .max(50, 'Account number too long')
    .trim()
    .optional(),
  initialBalance: z
    .number()
    .finite('Invalid amount')
    .default(0),
  currency: z.enum(['BRL', 'EUR', 'USD', 'GBP', 'CHF', 'CAD']).default('BRL'),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format')
    .default('#3B82F6'),
  icon: z
    .string()
    .max(50)
    .default('wallet'),
  isIncludedInTotal: z.boolean().default(true),
  notes: z.string().max(1000).optional(),
  holderType: z.enum(['pf', 'pj']).nullable().optional(),
  overdraftLimit: z.number().finite().min(0, 'Overdraft limit cannot be negative').optional(),
  balanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date').optional(),
});

/**
 * Account update schema
 */
export const updateAccountSchema = createAccountSchema.partial();

/**
 * Batch balance update schema
 */
export const updateBalancesSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date'),
  items: z.array(z.object({
    accountId: z.string().uuid('Invalid account ID'),
    balance: z.number().finite('Invalid amount'),
    note: z.string().max(500).optional(),
  })).min(1).max(100),
});

/**
 * Query parameters schema for account list
 */
export const listAccountsQuerySchema = z.object({
  type: z.enum(accountTypes).optional(),
  isActive: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
  includeInactive: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
  includeBalance: z
    .string()
    .transform((val) => val !== 'false')
    .default('true'),
});

/**
 * URL parameters schema
 */
export const accountIdParamSchema = z.object({
  id: z.string().uuid('Invalid account ID'),
});
