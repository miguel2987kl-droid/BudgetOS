import { Router } from 'express';
import * as financeController from '../controllers/financeController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFinancePermission, resolveWorkspaceContext } from '../middleware/workspaceContext.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validation.js';
import { auditQuerySchema, financeParametersSchema } from '../validators/finance.js';

const router = Router();

router.use(requireAuth);
router.use(resolveWorkspaceContext);

// Answers even for unmapped roles, so the client can hide the module (RF-IN-02).
router.get('/context', asyncHandler(financeController.getContext));
router.get('/parameters', requireFinancePermission('financeiro.visao_geral'), asyncHandler(financeController.getParameters));
router.put(
  '/parameters',
  requireFinancePermission('financeiro.relatorios.config', () => 'editar'),
  validate({ body: financeParametersSchema }),
  asyncHandler(financeController.updateParameters)
);
router.get(
  '/audit',
  requireFinancePermission('financeiro.auditoria'),
  validate({ query: auditQuerySchema }),
  asyncHandler(financeController.getAudit)
);

export default router;
