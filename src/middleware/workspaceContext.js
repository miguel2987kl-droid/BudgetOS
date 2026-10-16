import ClientWorkspace from '../models/ClientWorkspace.js';
import { permissionsFor, resolveActor } from '../services/financeAccess.js';
import { ForbiddenError } from '../utils/errors.js';

const findSessionWorkspace = async (workspaceId, userId) => {
  if (!workspaceId) return null;
  return ClientWorkspace.findAccessible(workspaceId, userId);
};

/** Resolves the selected workspace only after route authentication has populated req.user. */
export const resolveWorkspaceContext = (req, res, next) => {
  const actor = req.user;
  const headerWorkspaceId = req.get('X-Workspace-ID');

  // An explicit header must be accessible; a stale session choice falls back to the personal space.
  const resolveId = headerWorkspaceId
    ? Promise.resolve(headerWorkspaceId)
    : findSessionWorkspace(req.session?.activeWorkspaceId, actor.id).then((workspace) => workspace?.id || null);

  resolveId
    .then((workspaceId) => ClientWorkspace.resolveContext(workspaceId, actor.id))
    .then(async (workspace) => {
      req.actorUser = actor;
      req.workspace = workspace;
      const financeActor = await resolveActor(workspace);
      req.finance = { actor: financeActor, permissions: await permissionsFor(financeActor) };

      req.user = {
        ...actor,
        id: workspace.dataUserId,
        locale: workspace.locale,
        currency: workspace.currency,
        decimalSeparator: workspace.decimalSeparator,
        digitGrouping: workspace.digitGrouping,
      };

      next();
    })
    .catch(next);
};

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const defaultAction = (req) => {
  if (READ_METHODS.has(req.method)) return 'ver';
  if (req.method === 'DELETE') return 'excluir';
  if (req.method === 'POST') return 'criar';
  return 'editar';
};

/**
 * Finance module guard (RF-IN-02, RF-IN-07, RF-IN-08). Runs after
 * resolveWorkspaceContext. `resource` may be a function of the request, and
 * `actionFor` can name the action when the HTTP method alone does not say it.
 */
export const requireFinancePermission = (resourceFor, actionFor = null) => (req, res, next) => {
  const resource = typeof resourceFor === 'function' ? resourceFor(req) : resourceFor;
  const { actor, permissions } = req.finance || {};
  if (!actor) {
    throw new ForbiddenError('Your role has no access to the finance module', 'FINANCE_ROLE_UNMAPPED');
  }

  const action = actionFor?.(req) || defaultAction(req);
  if (!permissions[resource]?.includes(action)) {
    throw new ForbiddenError('You do not have permission for this action', 'FINANCE_PERMISSION_DENIED');
  }

  if (!READ_METHODS.has(req.method) && req.workspace && !req.workspace.isActive) {
    throw new ForbiddenError('This client is inactive: records can be viewed but not changed', 'WORKSPACE_INACTIVE');
  }

  next();
};
