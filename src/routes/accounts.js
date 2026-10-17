import { Router } from 'express';
import * as accountController from '../controllers/accountController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFinancePermission, resolveWorkspaceContext } from '../middleware/workspaceContext.js';
import { auditMutations } from '../services/auditService.js';
import { validate } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { createAccountSchema, updateAccountSchema, updateBalancesSchema, accountIdParamSchema, listAccountsQuerySchema } from '../validators/accounts.js';

const router = Router();

router.use(requireAuth);
router.use(resolveWorkspaceContext);
router.use(requireFinancePermission('financeiro.contas', (req) => {
  if (req.method === 'POST' && ['/recalculate', '/balances'].includes(req.path)) return 'atualizar_saldo';
  if (req.method === 'POST' && req.path !== '/') return 'editar';
  return null;
}));
router.use(auditMutations({ entity: 'conta', table: 'accounts' }));

router.post('/', validate({ body: createAccountSchema }), asyncHandler(accountController.createAccount));
router.get('/', validate({ query: listAccountsQuerySchema }), asyncHandler(accountController.getAccounts));
router.post('/recalculate', asyncHandler(accountController.recalculateBalances));
router.post('/balances', validate({ body: updateBalancesSchema }), asyncHandler(accountController.updateBalances));
router.get('/:id', validate({ params: accountIdParamSchema }), asyncHandler(accountController.getAccount));
router.put('/:id', validate({ params: accountIdParamSchema, body: updateAccountSchema }), asyncHandler(accountController.updateAccount));
router.delete('/:id', validate({ params: accountIdParamSchema }), asyncHandler(accountController.deleteAccount));
router.post('/:id/deactivate', validate({ params: accountIdParamSchema }), asyncHandler(accountController.deactivateAccount));
router.post('/:id/reactivate', validate({ params: accountIdParamSchema }), asyncHandler(accountController.reactivateAccount));
router.get('/:id/stats', validate({ params: accountIdParamSchema }), asyncHandler(accountController.getAccountStats));

export default router;
