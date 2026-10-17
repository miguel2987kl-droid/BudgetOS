import { z } from 'zod';
import { ACTORS, MEMBERSHIP_ROLES } from '../services/financeAccess.js';

export const financeParametersSchema = z.object({
  taxRate: z.number().min(0).max(100).optional(),
  incomeTaxRate: z.number().min(0).max(100).optional(),
  staleBalanceDays: z.number().int().min(1).max(365).optional(),
  defaultPeriod: z.enum(['month', 'quarter', 'year']).optional(),
});

export const auditQuerySchema = z.object({
  entity: z.string().max(50).optional(),
  entityId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const actorOrNone = z.enum(ACTORS).nullable();

export const roleMapSchema = z.object(
  Object.fromEntries(MEMBERSHIP_ROLES.map((role) => [role, actorOrNone]))
).partial();

export const permissionMatrixSchema = z.object({
  matrix: z.record(z.enum(ACTORS), z.record(z.string().max(60), z.array(z.string().max(40)))),
});

export const financeAdminSettingsSchema = z.object({
  workspaceRetentionDays: z.number().int().min(1).max(3650),
});
