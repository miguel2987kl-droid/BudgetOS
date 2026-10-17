import FinanceParameters from '../models/FinanceParameters.js';
import SystemSetting from '../models/SystemSetting.js';
import { listEvents, getHealth } from '../services/auditService.js';
import {
  CATALOG, ACTORS, MEMBERSHIP_ROLES,
  getRoleMap, setRoleMap, getMatrix, setMatrix, resetMatrix,
} from '../services/financeAccess.js';

export const DEFAULT_RETENTION_DAYS = 90;

export const getRetentionDays = async () => {
  const stored = Number(await SystemSetting.get('workspace_retention_days'));
  return Number.isInteger(stored) && stored > 0 ? stored : DEFAULT_RETENTION_DAYS;
};

export const getContext = async (req, res) => {
  res.json({
    success: true,
    data: {
      workspaceId: req.workspace.id,
      isActive: req.workspace.isActive,
      actor: req.finance.actor,
      permissions: req.finance.permissions,
      parameters: await FinanceParameters.get(req.workspace.id),
    },
  });
};

export const getParameters = async (req, res) => {
  res.json({ success: true, data: { parameters: await FinanceParameters.get(req.workspace.id) } });
};

export const updateParameters = async (req, res) => {
  const parameters = await FinanceParameters.update(req.workspace.id, req.body);
  res.json({ success: true, data: { parameters } });
};

export const getAudit = async (req, res) => {
  const events = await listEvents(req.workspace.id, req.query);
  res.json({ success: true, data: { events } });
};

export const getAccessConfig = async (req, res) => {
  res.json({
    success: true,
    data: {
      actors: ACTORS,
      membershipRoles: MEMBERSHIP_ROLES,
      catalog: CATALOG.map(({ key, actions, defaults }) => ({ key, actions, defaults })),
      roleMap: await getRoleMap(),
      matrix: await getMatrix(),
      workspaceRetentionDays: await getRetentionDays(),
    },
  });
};

export const updateRoleMap = async (req, res) => {
  const current = await getRoleMap();
  const roleMap = await setRoleMap({ ...current, ...req.body }, req.user.id);
  res.json({ success: true, data: { roleMap } });
};

export const updateMatrix = async (req, res) => {
  const matrix = await setMatrix(req.body.matrix, req.user.id);
  res.json({ success: true, data: { matrix } });
};

export const resetPermissionMatrix = async (req, res) => {
  const matrix = await resetMatrix(req.user.id);
  res.json({ success: true, data: { matrix } });
};

export const updateFinanceSettings = async (req, res) => {
  await SystemSetting.set('workspace_retention_days', String(req.body.workspaceRetentionDays), req.user.id);
  res.json({ success: true, data: { workspaceRetentionDays: await getRetentionDays() } });
};

export const getIntegrationHealth = async (req, res) => {
  res.json({ success: true, data: { audit: getHealth() } });
};
