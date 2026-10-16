import ClientWorkspace from '../models/ClientWorkspace.js';
import { recordChange } from '../services/auditService.js';
import { permissionsFor, resolveActor } from '../services/financeAccess.js';
import { getRetentionDays } from './financeController.js';

const withFinance = async (workspace) => {
  if (!workspace) return workspace;
  const actor = await resolveActor(workspace);
  return { ...workspace, finance: { actor, permissions: await permissionsFor(actor) } };
};

const auditWorkspace = (req, workspaceId, action, before, after) => recordChange({
  workspaceId, actorUserId: req.user.id, entity: 'empresa', entityId: workspaceId, action, before, after,
});

const strip = ({ dataUserId: _dataUserId, ...workspace }) => workspace;

export const listWorkspaces = async (req, res) => {
  const personal = await ClientWorkspace.ensurePersonal(req.user.id);
  const activeId = await ClientWorkspace.findAccessible(req.session.activeWorkspaceId, req.user.id)
    ? req.session.activeWorkspaceId
    : personal.id;
  req.session.activeWorkspaceId = activeId;

  const workspaces = await ClientWorkspace.findAllForUser(req.user.id, activeId);
  const activeWorkspace = await withFinance(workspaces.find((workspace) => workspace.active));
  res.json({ success: true, data: { workspaces, activeWorkspace } });
};

export const listArchivedWorkspaces = async (req, res) => {
  const workspaces = await ClientWorkspace.findArchivedForUser(req.user.id);
  res.json({ success: true, data: { workspaces, retentionDays: await getRetentionDays() } });
};

export const createWorkspace = async (req, res) => {
  const workspace = await ClientWorkspace.create(req.user.id, req.body);
  req.session.activeWorkspaceId = workspace.id;
  auditWorkspace(req, workspace.id, 'create', null, workspace);
  res.status(201).json({ success: true, data: { workspace: await withFinance(workspace) } });
};

export const activateWorkspace = async (req, res) => {
  const workspace = await ClientWorkspace.getAccessibleOrFail(req.params.workspaceId, req.user.id);
  req.session.activeWorkspaceId = workspace.id;
  res.json({ success: true, data: { workspace: await withFinance(strip(workspace)) } });
};

export const deactivateWorkspace = async (req, res) => {
  const before = await ClientWorkspace.getOwnedOrFail(req.params.workspaceId, req.user.id);
  // The user may stay on an inactive client: it is read-only, not hidden (RF-IN-08).
  const workspace = await ClientWorkspace.setActive(req.params.workspaceId, req.user.id, false);
  auditWorkspace(req, workspace.id, 'deactivate', strip(before), strip(workspace));
  res.json({ success: true, data: { workspace: strip(workspace) } });
};

export const reactivateWorkspace = async (req, res) => {
  const before = await ClientWorkspace.getOwnedOrFail(req.params.workspaceId, req.user.id);
  const workspace = await ClientWorkspace.setActive(req.params.workspaceId, req.user.id, true);
  auditWorkspace(req, workspace.id, 'reactivate', strip(before), strip(workspace));
  res.json({ success: true, data: { workspace: strip(workspace) } });
};

export const updateWorkspaceNotes = async (req, res) => {
  const workspace = await ClientWorkspace.updateNotes(
    req.params.workspaceId,
    req.user.id,
    req.body.notes
  );
  res.json({ success: true, data: { workspace: strip(workspace) } });
};

export const deleteWorkspace = async (req, res) => {
  const { workspaceId } = req.params;
  const before = await ClientWorkspace.getOwnedOrFail(workspaceId, req.user.id);
  if (req.session.activeWorkspaceId === workspaceId) {
    const personal = await ClientWorkspace.ensurePersonal(req.user.id);
    req.session.activeWorkspaceId = personal.id;
  }
  await ClientWorkspace.archive(workspaceId, req.user.id);
  const retentionDays = await getRetentionDays();
  auditWorkspace(req, workspaceId, 'archive', strip(before), null);
  res.json({ success: true, data: { message: 'Workspace archived', retentionDays } });
};

export const restoreWorkspace = async (req, res) => {
  const workspace = await ClientWorkspace.restore(req.params.workspaceId, req.user.id);
  auditWorkspace(req, workspace.id, 'restore', null, strip(workspace));
  res.json({ success: true, data: { workspace: strip(workspace) } });
};

export const listMembers = async (req, res) => {
  const members = await ClientWorkspace.listMembers(req.params.workspaceId, req.user.id);
  res.json({ success: true, data: { members } });
};

export const addMember = async (req, res) => {
  const members = await ClientWorkspace.addMember(req.params.workspaceId, req.user.id, req.body);
  const added = members.find((member) => member.email === req.body.email);
  recordChange({
    workspaceId: req.params.workspaceId, actorUserId: req.user.id, entity: 'vinculo',
    entityId: added?.userId, action: 'create', before: null, after: { userId: added?.userId, role: req.body.role },
  });
  res.status(201).json({ success: true, data: { members } });
};

export const updateMember = async (req, res) => {
  const { workspaceId, userId } = req.params;
  const members = await ClientWorkspace.updateMemberRole(workspaceId, req.user.id, userId, req.body.role);
  recordChange({
    workspaceId, actorUserId: req.user.id, entity: 'vinculo', entityId: userId, action: 'update',
    before: null, after: { userId, role: req.body.role },
  });
  res.json({ success: true, data: { members } });
};

export const removeMember = async (req, res) => {
  const { workspaceId, userId } = req.params;
  const members = await ClientWorkspace.removeMember(workspaceId, req.user.id, userId);
  recordChange({
    workspaceId, actorUserId: req.user.id, entity: 'vinculo', entityId: userId, action: 'delete',
    before: { userId }, after: null,
  });
  res.json({ success: true, data: { members } });
};
