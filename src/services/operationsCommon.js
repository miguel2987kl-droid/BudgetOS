import { addDays, addMonths, parseISO } from 'date-fns';
import { formatDateISO, roundAmount } from '../utils/helpers.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';

/** Shared helpers for the PAINEL operation records (R2). */

/** Dates come back as strings on SQLite and as Date objects on PostgreSQL/MySQL. */
export const isoDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return formatDateISO(value);
  return String(value).slice(0, 10);
};

export const today = () => formatDateISO(new Date());

export const shiftDays = (date, days) => formatDateISO(addDays(parseISO(isoDate(date)), days));

export const shiftMonths = (date, months) => formatDateISO(addMonths(parseISO(isoDate(date)), months));

export const money = (value) => roundAmount(Number(value || 0));

export const bool = (value) => value === true || value === 1 || value === '1' || value === 'true';

/** Split a total into `count` cent-exact parts; the first parts take the remainder. */
export const splitAmount = (total, count) => {
  const cents = Math.round(Math.abs(total) * 100);
  const base = Math.floor(cents / count);
  const remainder = cents % count;
  return Array.from({ length: count }, (_, index) => (base + (index < remainder ? 1 : 0)) / 100);
};

export async function ensureCategory(db, userId, categoryId) {
  if (!categoryId) return null;
  const category = await db('categories')
    .where('id', categoryId)
    .where(function ownOrSystem() { this.where('user_id', userId).orWhereNull('user_id'); })
    .first();
  if (!category) throw new NotFoundError('Category not found', 'CATEGORY_NOT_FOUND');
  return category;
}

/** RN-09: a paid or received item needs its effective date and amount. */
export const requireEffective = ({ date, amount }) => {
  if (!date || !(Number(amount) > 0)) {
    throw new BadRequestError('Paid or received items need the effective date and amount', 'EFFECTIVE_VALUES_REQUIRED');
  }
};
