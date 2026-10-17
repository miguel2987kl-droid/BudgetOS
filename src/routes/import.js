import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import * as importController from '../controllers/importController.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFinancePermission, resolveWorkspaceContext } from '../middleware/workspaceContext.js';
import { auditMutations } from '../services/auditService.js';
import { uploadRateLimiter } from '../middleware/security.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import config from '../config/index.js';
import { generateId } from '../utils/helpers.js';

const router = Router();

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.paths.uploads),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${generateId()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.upload.maxSize },
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.csv', '.xlsx', '.xls', '.qif', '.qfx', '.ofx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) cb(null, true);
    else cb(new Error('Type de fichier non autorisé'));
  },
});

router.use(requireAuth);
router.use(resolveWorkspaceContext);
router.use(requireFinancePermission('financeiro.entradas'));
router.use(auditMutations({ entity: 'importacao', table: null }));

// New unified routes: analyze (upload + parse + match) and confirm
router.post('/analyze', uploadRateLimiter, upload.single('file'), asyncHandler(importController.analyzeImport));
router.post('/confirm', asyncHandler(importController.confirmImport));
router.get('/match-candidates', asyncHandler(importController.getMatchCandidates));
router.get('/history', asyncHandler(importController.getImportHistory));
router.get('/:id', asyncHandler(importController.getImport));

export default router;
