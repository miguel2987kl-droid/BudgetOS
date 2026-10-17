import { Router } from 'express';
import * as workspaceController from '../controllers/workspaceController.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validation.js';
import {
  addWorkspaceMemberSchema,
  createWorkspaceSchema,
  updateWorkspaceMemberSchema,
  updateWorkspaceNotesSchema,
  workspaceIdParamSchema,
  workspaceMemberParamSchema,
} from '../validators/workspaces.js';

const router = Router();

router.use(requireAuth);
router.get('/', asyncHandler(workspaceController.listWorkspaces));
router.get('/archived', asyncHandler(workspaceController.listArchivedWorkspaces));
router.post('/', validate({ body: createWorkspaceSchema }), asyncHandler(workspaceController.createWorkspace));
router.post('/:workspaceId/activate', validate({ params: workspaceIdParamSchema }), asyncHandler(workspaceController.activateWorkspace));
router.post('/:workspaceId/deactivate', validate({ params: workspaceIdParamSchema }), asyncHandler(workspaceController.deactivateWorkspace));
router.post('/:workspaceId/reactivate', validate({ params: workspaceIdParamSchema }), asyncHandler(workspaceController.reactivateWorkspace));
router.put('/:workspaceId/notes', validate({ params: workspaceIdParamSchema, body: updateWorkspaceNotesSchema }), asyncHandler(workspaceController.updateWorkspaceNotes));
router.delete('/:workspaceId', validate({ params: workspaceIdParamSchema }), asyncHandler(workspaceController.deleteWorkspace));
router.post('/:workspaceId/restore', validate({ params: workspaceIdParamSchema }), asyncHandler(workspaceController.restoreWorkspace));
router.get('/:workspaceId/members', validate({ params: workspaceIdParamSchema }), asyncHandler(workspaceController.listMembers));
router.post('/:workspaceId/members', validate({ params: workspaceIdParamSchema, body: addWorkspaceMemberSchema }), asyncHandler(workspaceController.addMember));
router.put('/:workspaceId/members/:userId', validate({ params: workspaceMemberParamSchema, body: updateWorkspaceMemberSchema }), asyncHandler(workspaceController.updateMember));
router.delete('/:workspaceId/members/:userId', validate({ params: workspaceMemberParamSchema }), asyncHandler(workspaceController.removeMember));

export default router;
