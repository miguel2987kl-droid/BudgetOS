import SystemSetting from '../models/SystemSetting.js';

/**
 * Finance module access control (PAINEL spec, sections 5 and 10.2).
 *
 * Workspace membership roles are BudgetOS's own roles. Each one is mapped,
 * by configuration, to a module actor; the actor's permissions come from the
 * resource catalog below, with optional overrides set by the super admin.
 */

export const ACTORS = ['admin', 'operator', 'client'];
export const MEMBERSHIP_ROLES = ['owner', 'collaborator', 'client'];
export const DEFAULT_ROLE_MAP = { owner: 'admin', collaborator: 'operator', client: 'client' };

const all = (actions) => actions;
const allBut = (actions, excluded) => actions.filter((action) => action !== excluded);

const resource = (key, actions, defaults) => ({ key, actions, defaults });

/** Catalog of section 10.2, with the default actions of each actor. */
export const CATALOG = [
  resource('financeiro.visao_geral', ['ver'], { admin: ['ver'], operator: ['ver'], client: ['ver'] }),
  resource('financeiro.relatorios', ['ver', 'exportar', 'publicar_fechamento'], {
    admin: ['ver', 'exportar', 'publicar_fechamento'],
    operator: ['ver', 'exportar', 'publicar_fechamento'],
    client: ['ver', 'exportar'],
  }),
  resource('financeiro.relatorios.config', ['editar'], { admin: ['editar'], operator: ['editar'], client: [] }),
  ...[
    ['financeiro.contas', ['ver', 'criar', 'editar', 'excluir', 'atualizar_saldo'], []],
    ['financeiro.cartoes', ['ver', 'criar', 'editar', 'excluir'], []],
    ['financeiro.faturas', ['ver', 'lancar', 'pagar', 'excluir'], []],
    ['financeiro.vendas_cartao', ['ver', 'criar', 'editar', 'creditar', 'excluir'], []],
    ['financeiro.entradas', ['ver', 'criar', 'editar', 'excluir'], []],
    ['financeiro.recorrencias', ['ver', 'criar', 'editar', 'pagar', 'encerrar', 'excluir'], []],
    ['financeiro.receitas', ['ver', 'criar', 'editar', 'cancelar', 'excluir'], ['ver']],
  ].map(([key, actions, client]) => resource(key, actions, {
    admin: all(actions), operator: allBut(actions, 'excluir'), client,
  })),
  resource('financeiro.precificacao', ['ver', 'criar', 'editar', 'excluir'], {
    admin: ['ver', 'criar', 'editar', 'excluir'], operator: ['ver', 'criar', 'editar', 'excluir'], client: [],
  }),
  resource('financeiro.documentos', ['ver', 'solicitar', 'enviar', 'avaliar'], {
    admin: ['ver', 'solicitar', 'enviar', 'avaliar'],
    operator: ['ver', 'solicitar', 'enviar', 'avaliar'],
    client: ['ver', 'enviar'],
  }),
  resource('financeiro.mensagens', ['ver', 'enviar'], { admin: ['ver', 'enviar'], operator: ['ver', 'enviar'], client: ['ver', 'enviar'] }),
  resource('financeiro.saldos', ['ver'], { admin: ['ver'], operator: ['ver'], client: [] }),
  resource('financeiro.migracao', ['importar'], { admin: ['importar'], operator: [], client: [] }),
  resource('financeiro.auditoria', ['ver'], { admin: ['ver'], operator: ['ver'], client: [] }),
];

const CATALOG_BY_KEY = new Map(CATALOG.map((entry) => [entry.key, entry]));

const parseJson = (value, fallback) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export async function getRoleMap() {
  const stored = parseJson(await SystemSetting.get('finance_role_map'), {});
  const map = { ...DEFAULT_ROLE_MAP };
  for (const role of MEMBERSHIP_ROLES) {
    if (Object.hasOwn(stored, role)) map[role] = ACTORS.includes(stored[role]) ? stored[role] : null;
  }
  return map;
}

export async function setRoleMap(map, updatedBy) {
  const clean = {};
  for (const role of MEMBERSHIP_ROLES) {
    clean[role] = ACTORS.includes(map[role]) ? map[role] : null;
  }
  await SystemSetting.set('finance_role_map', JSON.stringify(clean), updatedBy);
  return getRoleMap();
}

/** Effective matrix: { actor: { resource: [actions] } }. */
export async function getMatrix() {
  const overrides = parseJson(await SystemSetting.get('finance_permission_overrides'), {});
  const matrix = {};
  for (const actor of ACTORS) {
    matrix[actor] = {};
    for (const entry of CATALOG) {
      const override = overrides?.[actor]?.[entry.key];
      matrix[actor][entry.key] = Array.isArray(override)
        ? override.filter((action) => entry.actions.includes(action))
        : [...entry.defaults[actor]];
    }
  }
  return matrix;
}

export async function setMatrix(matrix, updatedBy) {
  const overrides = {};
  for (const actor of ACTORS) {
    for (const entry of CATALOG) {
      const actions = matrix?.[actor]?.[entry.key];
      if (!Array.isArray(actions)) continue;
      const allowed = entry.actions.filter((action) => actions.includes(action));
      const defaults = entry.defaults[actor];
      const same = allowed.length === defaults.length && allowed.every((action) => defaults.includes(action));
      if (!same) {
        overrides[actor] ??= {};
        overrides[actor][entry.key] = allowed;
      }
    }
  }
  await SystemSetting.set('finance_permission_overrides', JSON.stringify(overrides), updatedBy);
  return getMatrix();
}

export async function resetMatrix(updatedBy) {
  await SystemSetting.set('finance_permission_overrides', null, updatedBy);
  return getMatrix();
}

/**
 * Actor of a user in a workspace. The personal space always belongs to its
 * owner; elsewhere the membership role goes through the configured map.
 */
export async function resolveActor(workspace) {
  if (!workspace) return null;
  if (workspace.isPersonal) return 'admin';
  const map = await getRoleMap();
  return map[workspace.role] || null;
}

/** Permissions of an actor, as { resource: [actions] } (empty when unmapped). */
export async function permissionsFor(actor) {
  if (!actor) return {};
  const matrix = await getMatrix();
  return matrix[actor] || {};
}

export function isKnownPermission(resourceKey, action) {
  return Boolean(CATALOG_BY_KEY.get(resourceKey)?.actions.includes(action));
}
