import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireFinancePermission, resolveWorkspaceContext } from '../middleware/workspaceContext.js';
import { auditMutations } from '../services/auditService.js';
import {
  getPayees,
  getPayee,
  createPayee,
  updatePayee,
  deletePayee,
  getPayeeTransactionCount,
  reassignPayeeTransactions,
} from '../controllers/payeeController.js';

const router = Router();

router.use(requireAuth);
router.use(resolveWorkspaceContext);
router.use(requireFinancePermission(
  (req) => (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? 'financeiro.visao_geral' : 'financeiro.relatorios.config'),
  (req) => (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? 'ver' : 'editar'),
));
router.use(auditMutations({ entity: 'favorecido', table: 'payees' }));

router.get('/', getPayees);
router.get('/:id', getPayee);
router.get('/:id/transactions/count', getPayeeTransactionCount);
router.post('/:id/transactions/reassign', reassignPayeeTransactions);
router.post('/', createPayee);
router.put('/:id', updatePayee);
router.delete('/:id', deletePayee);

export default router;
