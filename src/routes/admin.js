import { Router } from 'express';
import * as adminController from '../controllers/adminController.js';
import * as financeController from '../controllers/financeController.js';
import { requireSuperAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  createUserSchema,
  updateUserSchema,
  updateRoleSchema,
  updateSettingsSchema,
  userListQuerySchema,
} from '../validators/admin.js';
import { financeAdminSettingsSchema, permissionMatrixSchema, roleMapSchema } from '../validators/finance.js';

const router = Router();

// User management
router.get('/users', requireSuperAdmin, validate({ query: userListQuerySchema }), asyncHandler(adminController.listUsers));
router.get('/users/:userId', requireSuperAdmin, asyncHandler(adminController.getUser));
router.post('/users', requireSuperAdmin, validate({ body: createUserSchema }), asyncHandler(adminController.createUser));
router.put('/users/:userId', requireSuperAdmin, validate({ body: updateUserSchema }), asyncHandler(adminController.updateUser));
router.put('/users/:userId/suspend', requireSuperAdmin, asyncHandler(adminController.suspendUser));
router.put('/users/:userId/reactivate', requireSuperAdmin, asyncHandler(adminController.reactivateUser));
router.put('/users/:userId/role', requireSuperAdmin, validate({ body: updateRoleSchema }), asyncHandler(adminController.updateUserRole));
router.delete('/users/:userId', requireSuperAdmin, asyncHandler(adminController.deleteUser));

// System settings
router.get('/settings', requireSuperAdmin, asyncHandler(adminController.getSettings));
router.put('/settings', requireSuperAdmin, validate({ body: updateSettingsSchema }), asyncHandler(adminController.updateSettings));

// SMTP settings
router.get('/smtp', requireSuperAdmin, asyncHandler(adminController.getSmtpSettings));
router.put('/smtp', requireSuperAdmin, asyncHandler(adminController.updateSmtpSettings));
router.post('/smtp/test', requireSuperAdmin, asyncHandler(adminController.testSmtpConnection));

// Maintenance: duplicate recurring transactions
router.get('/duplicates/recurring', requireSuperAdmin, asyncHandler(adminController.previewRecurringDuplicates));
router.post('/duplicates/recurring/cleanup', requireSuperAdmin, asyncHandler(adminController.cleanupRecurringDuplicates));

// Finance module access (RF-IN-01, RF-IN-07) and integration health (RF-IN-06)
router.get('/finance/access', requireSuperAdmin, asyncHandler(financeController.getAccessConfig));
router.put('/finance/roles', requireSuperAdmin, validate({ body: roleMapSchema }), asyncHandler(financeController.updateRoleMap));
router.put('/finance/permissions', requireSuperAdmin, validate({ body: permissionMatrixSchema }), asyncHandler(financeController.updateMatrix));
router.post('/finance/permissions/reset', requireSuperAdmin, asyncHandler(financeController.resetPermissionMatrix));
router.put('/finance/settings', requireSuperAdmin, validate({ body: financeAdminSettingsSchema }), asyncHandler(financeController.updateFinanceSettings));
router.get('/integration-health', requireSuperAdmin, asyncHandler(financeController.getIntegrationHealth));

export default router;
