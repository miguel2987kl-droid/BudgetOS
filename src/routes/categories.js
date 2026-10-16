import { Router } from 'express';
import * as categoryController from '../controllers/categoryController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFinancePermission, resolveWorkspaceContext } from '../middleware/workspaceContext.js';
import { auditMutations } from '../services/auditService.js';
import { validate } from '../middleware/validation.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { createCategorySchema, updateCategorySchema, categoryIdParamSchema, listCategoriesQuerySchema } from '../validators/categories.js';

const router = Router();

router.use(requireAuth);
router.use(resolveWorkspaceContext);
router.use(requireFinancePermission(
  (req) => (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? 'financeiro.visao_geral' : 'financeiro.relatorios.config'),
  (req) => (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? 'ver' : 'editar'),
));
router.use(auditMutations({ entity: 'categoria', table: 'categories' }));

router.post('/', validate({ body: createCategorySchema }), asyncHandler(categoryController.createCategory));
router.get('/', validate({ query: listCategoriesQuerySchema }), asyncHandler(categoryController.getCategories));
router.get('/:id', validate({ params: categoryIdParamSchema }), asyncHandler(categoryController.getCategory));
router.put('/:id', validate({ params: categoryIdParamSchema, body: updateCategorySchema }), asyncHandler(categoryController.updateCategory));
router.delete('/:id', validate({ params: categoryIdParamSchema }), asyncHandler(categoryController.deleteCategory));

export default router;
