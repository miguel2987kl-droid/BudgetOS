import knex from '../database/connection.js';
import { generateId } from '../utils/helpers.js';
import logger from '../utils/logger.js';

/**
 * Audit trail for finance records (INT-07, RF-IN-16).
 *
 * Events are written after the response, so a failing write never undoes the
 * financial operation (RF-IN-06). Failed writes stay in a retry queue that is
 * flushed with backoff, and the super admin can see what is still pending.
 */

const MAX_QUEUE = 1000;
const MAX_ATTEMPTS = 8;
const MAX_FAILURE_LOG = 50;

const queue = [];
const failures = [];
let flushTimer = null;

const toJson = (value) => (value === undefined || value === null ? null : JSON.stringify(value));

const parseJson = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const insertEvent = (row) => knex('audit_events').insert(row);

const rememberFailure = (row, error) => {
  failures.unshift({ at: new Date().toISOString(), entity: row.entity, entityId: row.entity_id, action: row.action, error: error.message });
  failures.length = Math.min(failures.length, MAX_FAILURE_LOG);
};

const scheduleFlush = () => {
  if (flushTimer || queue.length === 0) return;
  const delay = Math.min(60_000, 1000 * 2 ** Math.min(queue[0].attempts, 6));
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushRetries().catch(() => {});
  }, delay);
  flushTimer.unref?.();
};

const enqueue = (row, error) => {
  rememberFailure(row, error);
  if (queue.length >= MAX_QUEUE) {
    const dropped = queue.shift();
    logger.error('Audit retry queue full; dropping oldest event', { entity: dropped.row.entity, entityId: dropped.row.entity_id });
  }
  queue.push({ row, attempts: 1 });
  scheduleFlush();
};

export async function flushRetries() {
  const pending = queue.splice(0, queue.length);
  for (const item of pending) {
    try {
      await insertEvent(item.row);
    } catch (error) {
      item.attempts += 1;
      if (item.attempts >= MAX_ATTEMPTS) {
        rememberFailure(item.row, error);
        logger.error('Audit event abandoned after retries', { entity: item.row.entity, entityId: item.row.entity_id, error: error.message });
      } else {
        queue.push(item);
      }
    }
  }
  scheduleFlush();
}

/**
 * Record a `registro.alterado` event. Never throws.
 */
export async function recordChange({ workspaceId, actorUserId, entity, entityId, action, before, after }) {
  const row = {
    id: generateId(),
    workspace_id: workspaceId || null,
    actor_user_id: actorUserId || null,
    event: 'registro.alterado',
    entity,
    entity_id: entityId || null,
    action,
    before_data: toJson(before),
    after_data: toJson(after),
    created_at: new Date(),
  };
  try {
    await insertEvent(row);
  } catch (error) {
    logger.warn('Audit write failed; queued for retry', { entity, entityId, error: error.message });
    enqueue(row, error);
  }
}

export function getHealth() {
  return { pending: queue.length, recentFailures: [...failures] };
}

/** Test hook. */
export function resetState() {
  queue.length = 0;
  failures.length = 0;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}

export async function listEvents(workspaceId, { entity, entityId, limit = 50 } = {}) {
  const rows = await knex('audit_events as a')
    .leftJoin('users as u', 'u.id', 'a.actor_user_id')
    .where('a.workspace_id', workspaceId)
    .modify((query) => {
      if (entity) query.where('a.entity', entity);
      if (entityId) query.where('a.entity_id', entityId);
    })
    .select('a.*', 'u.email as actor_email', 'u.first_name as actor_first_name', 'u.last_name as actor_last_name')
    .orderBy('a.created_at', 'desc')
    .limit(Math.min(Number(limit) || 50, 200));

  return rows.map((row) => ({
    id: row.id,
    event: row.event,
    entity: row.entity,
    entityId: row.entity_id,
    action: row.action,
    actor: row.actor_user_id
      ? { id: row.actor_user_id, email: row.actor_email, name: [row.actor_first_name, row.actor_last_name].filter(Boolean).join(' ') }
      : null,
    before: parseJson(row.before_data),
    after: parseJson(row.after_data),
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const findIdInBody = (body) => {
  const data = body?.data;
  if (!data || typeof data !== 'object') return null;
  if (typeof data.id === 'string') return data.id;
  for (const value of Object.values(data)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.id === 'string') return value.id;
  }
  return null;
};

const actionName = (method, subPath, hadId) => {
  if (subPath) return subPath.replace(/[^a-z_-]/gi, '').slice(0, 30) || 'update';
  if (method === 'POST' && !hadId) return 'create';
  if (method === 'DELETE') return 'delete';
  return 'update';
};

/**
 * Router middleware: records every successful mutation on a workspace-scoped
 * table with the row as it was before and after (without a table, only the
 * request body is kept). Requires resolveWorkspaceContext to have run.
 */
export const auditMutations = ({ entity, table }) => (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const segments = req.path.split('/').filter(Boolean);
  const pathId = segments[0] && UUID.test(segments[0]) ? segments[0] : null;
  const subPath = pathId ? segments.slice(1).join('_') : segments.join('_');
  const ownerId = req.user.id;
  const loadRow = (id) => (id && table ? knex(table).where({ id, user_id: ownerId }).first() : Promise.resolve(null));

  let responseBody;
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    responseBody = body;
    return originalJson(body);
  };

  loadRow(pathId)
    .catch(() => null)
    .then((before) => {
      res.on('finish', () => {
        if (res.statusCode >= 400 || res.locals.auditRecorded) return;
        const entityId = pathId || findIdInBody(responseBody);
        loadRow(entityId)
          .catch(() => null)
          .then((after) => recordChange({
            workspaceId: req.workspace?.id,
            actorUserId: req.actorUser?.id,
            entity,
            entityId,
            action: actionName(req.method, subPath, Boolean(pathId)),
            before: before || null,
            after: after || (table && entityId ? null : req.body || null),
          }));
      });
      next();
    });
};

export default { recordChange, listEvents, getHealth, flushRetries, auditMutations };
