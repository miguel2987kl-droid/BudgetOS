import { Router } from 'express';
import * as reportController from '../controllers/reportController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFinancePermission, resolveWorkspaceContext } from '../middleware/workspaceContext.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

router.use(requireAuth);
router.use(resolveWorkspaceContext);
router.use(requireFinancePermission((req) => (req.path === '/dashboard' ? 'financeiro.visao_geral' : 'financeiro.relatorios')));

router.get('/dashboard', asyncHandler(reportController.getDashboard));
router.get('/expenses/category', asyncHandler(reportController.getExpensesByCategory));
router.get('/income/category', asyncHandler(reportController.getIncomeByCategory));
router.get('/expenses/credit-card', asyncHandler(reportController.getExpensesByCreditCard));
router.get('/trend/monthly', asyncHandler(reportController.getMonthlyTrend));
router.get('/comparison', asyncHandler(reportController.getMonthComparison));
router.get('/forecast/transactions', asyncHandler(reportController.getForecastTransactions));
router.get('/forecast', asyncHandler(reportController.getForecast));
router.get('/forecast/monthly', asyncHandler(reportController.getMonthlyForecast));
router.get('/projections', asyncHandler(reportController.getProjections));

export default router;
