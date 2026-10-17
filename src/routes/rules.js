import { Router } from 'express';
import * as ruleController from '../controllers/ruleController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFinancePermission, resolveWorkspaceContext } from '../middleware/workspaceContext.js';
import { auditMutations } from '../services/auditService.js';
import { validate } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { createRuleSchema, updateRuleSchema, ruleIdParamSchema, listRulesQuerySchema, testRuleSchema } from '../validators/rules.js';

const router = Router();

router.use(requireAuth);
router.use(resolveWorkspaceContext);
router.use(requireFinancePermission(
  (req) => (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? 'financeiro.visao_geral' : 'financeiro.relatorios.config'),
  (req) => (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? 'ver' : 'editar'),
));
router.use(auditMutations({ entity: 'regra', table: 'rules' }));

router.post('/', validate({ body: createRuleSchema }), asyncHandler(ruleController.createRule));
router.get('/', validate({ query: listRulesQuerySchema }), asyncHandler(ruleController.getRules));
router.get('/:id', validate({ params: ruleIdParamSchema }), asyncHandler(ruleController.getRule));
router.put('/:id', validate({ params: ruleIdParamSchema, body: updateRuleSchema }), asyncHandler(ruleController.updateRule));
router.delete('/:id', validate({ params: ruleIdParamSchema }), asyncHandler(ruleController.deleteRule));
router.post('/:id/test', validate({ params: ruleIdParamSchema, body: testRuleSchema }), asyncHandler(ruleController.testRule));
router.post('/:id/apply', validate({ params: ruleIdParamSchema }), asyncHandler(ruleController.applyRuleToTransaction));

export default router;
