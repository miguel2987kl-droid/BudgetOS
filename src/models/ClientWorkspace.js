import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import knex from '../database/connection.js';
import config from '../config/index.js';
import User from './User.js';
import { generateId } from '../utils/helpers.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../utils/errors.js';

const defaultsForLocale = (locale) => locale === 'pt'
  ? { decimalSeparator: ',', digitGrouping: '.' }
  : locale === 'fr'
    ? { decimalSeparator: ',', digitGrouping: ' ' }
    : { decimalSeparator: '.', digitGrouping: ',' };

const format = (workspace, role, active = false) => ({
  id: workspace.id,
  name: workspace.name,
  currency: workspace.currency,
  locale: workspace.locale,
  decimalSeparator: workspace.decimal_separator,
  digitGrouping: workspace.digit_grouping,
  isPersonal: Boolean(workspace.is_personal),
  isActive: Boolean(workspace.is_active),
  notes: workspace.notes || '',
  archivedAt: workspace.archived_at ? new Date(workspace.archived_at).toISOString() : null,
  role,
  active,
});

export default class ClientWorkspace {
  static async ensurePersonal(userId) {
    let workspace = await knex('client_workspaces')
      .where({ data_user_id: userId, is_personal: true })
      .first();
    if (workspace) return workspace;

    const user = await knex('users')
      .select('locale', 'currency', 'decimal_separator', 'digit_grouping')
      .where({ id: userId, is_workspace_identity: false })
      .first();
    if (!user) throw new NotFoundError('User not found', 'USER_NOT_FOUND');

    const id = generateId();
    try {
      await knex.transaction(async (trx) => {
        const existing = await trx('client_workspaces')
          .where({ data_user_id: userId, is_personal: true })
          .first();
        if (existing) return;

        await trx('client_workspaces').insert({
          id,
          name: 'Personal',
          data_user_id: userId,
          created_by: userId,
          currency: user.currency || 'EUR',
          locale: user.locale || 'fr',
          decimal_separator: user.decimal_separator || ',',
          digit_grouping: user.digit_grouping ?? ' ',
          is_personal: true,
        });
        await trx('client_workspace_members').insert({
          id: generateId(), workspace_id: id, user_id: userId, role: 'owner',
        });
        await trx('finance_parameters').insert({ workspace_id: id });
      });
    } catch (error) {
      const createdByConcurrentRequest = await knex('client_workspaces')
        .where({ data_user_id: userId, is_personal: true })
        .first();
      if (!createdByConcurrentRequest) throw error;
    }

    return knex('client_workspaces').where({ data_user_id: userId, is_personal: true }).first();
  }

  static async create(userId, data) {
    const workspaceId = generateId();
    const dataUserId = generateId();
    const locale = data.locale || 'pt';
    const currency = data.currency || (locale === 'pt' ? 'BRL' : 'EUR');
    const localeDefaults = defaultsForLocale(locale);
    const decimalSeparator = data.decimalSeparator || localeDefaults.decimalSeparator;
    const digitGrouping = data.digitGrouping ?? localeDefaults.digitGrouping;
    const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), config.security.bcryptRounds);

    await knex.transaction(async (trx) => {
      await trx('users').insert({
        id: dataUserId,
        email: `workspace-${dataUserId}@workspace.budgetos.internal`,
        password_hash: passwordHash,
        first_name: data.name,
        role: 'user',
        locale,
        currency,
        decimal_separator: decimalSeparator,
        digit_grouping: digitGrouping,
        is_workspace_identity: true,
      });
      await User._insertDefaults(trx, dataUserId, locale);
      await trx('client_workspaces').insert({
        id: workspaceId,
        name: data.name,
        data_user_id: dataUserId,
        created_by: userId,
        currency,
        locale,
        decimal_separator: decimalSeparator,
        digit_grouping: digitGrouping,
        notes: data.notes?.trim() || null,
      });
      await trx('client_workspace_members').insert({
        id: generateId(), workspace_id: workspaceId, user_id: userId, role: 'owner',
      });
      await trx('finance_parameters').insert({ workspace_id: workspaceId });
    });

    return ClientWorkspace.findAccessible(workspaceId, userId);
  }

  static async findAllForUser(userId, activeId = null) {
    const workspaces = await knex('client_workspaces as w')
      .join('client_workspace_members as m', 'm.workspace_id', 'w.id')
      .where('m.user_id', userId)
      .whereNull('w.archived_at')
      .select('w.*', 'm.role')
      .orderBy('w.is_personal', 'desc')
      .orderBy('w.name', 'asc');
    return workspaces.map((workspace) => format(workspace, workspace.role, workspace.id === activeId));
  }

  static async findAccessible(id, userId) {
    if (!id) return null;
    const workspace = await knex('client_workspaces as w')
      .join('client_workspace_members as m', 'm.workspace_id', 'w.id')
      .where({ 'w.id': id, 'm.user_id': userId })
      .whereNull('w.archived_at')
      .select('w.*', 'm.role')
      .first();
    return workspace ? format(workspace, workspace.role) : null;
  }

  static async getOwnedOrFail(id, userId, { archived = false } = {}) {
    const workspace = await knex('client_workspaces as w')
      .join('client_workspace_members as m', 'm.workspace_id', 'w.id')
      .where({ 'w.id': id, 'm.user_id': userId, 'm.role': 'owner', 'w.is_personal': false })
      .modify((query) => (archived ? query.whereNotNull('w.archived_at') : query.whereNull('w.archived_at')))
      .select('w.*', 'm.role')
      .first();
    if (!workspace) throw new ForbiddenError('Workspace management denied', 'WORKSPACE_FORBIDDEN');
    return { ...format(workspace, workspace.role), dataUserId: workspace.data_user_id };
  }

  static async setActive(id, userId, isActive) {
    await ClientWorkspace.getOwnedOrFail(id, userId);
    await knex('client_workspaces').where({ id }).update({ is_active: isActive, updated_at: knex.fn.now() });
    return ClientWorkspace.getOwnedOrFail(id, userId);
  }

  static async updateNotes(id, userId, notes) {
    await ClientWorkspace.getOwnedOrFail(id, userId);
    await knex('client_workspaces').where({ id }).update({
      notes: notes?.trim() || null,
      updated_at: knex.fn.now(),
    });
    return ClientWorkspace.getOwnedOrFail(id, userId);
  }

  /**
   * RN-16: deleting a client archives it. Its finance data stays until the
   * retention window ends, then purgeExpired removes it for good.
   */
  static async archive(id, userId) {
    await ClientWorkspace.getOwnedOrFail(id, userId);
    await knex('client_workspaces').where({ id }).update({
      archived_at: new Date(), archived_by: userId, is_active: false, updated_at: knex.fn.now(),
    });
  }

  static async findArchivedForUser(userId) {
    const rows = await knex('client_workspaces as w')
      .join('client_workspace_members as m', 'm.workspace_id', 'w.id')
      .where({ 'm.user_id': userId, 'm.role': 'owner' })
      .whereNotNull('w.archived_at')
      .select('w.*', 'm.role')
      .orderBy('w.archived_at', 'desc');
    return rows.map((row) => format(row, row.role));
  }

  static async restore(id, userId) {
    await ClientWorkspace.getOwnedOrFail(id, userId, { archived: true });
    await knex('client_workspaces').where({ id }).update({
      archived_at: null, archived_by: null, is_active: true, updated_at: knex.fn.now(),
    });
    return ClientWorkspace.getOwnedOrFail(id, userId);
  }

  static async purge(id) {
    const workspace = await knex('client_workspaces').where({ id, is_personal: false }).first();
    if (!workspace) return;
    await knex.transaction(async (trx) => {
      await trx('client_workspaces').where({ id }).del();
      await trx('users').where({ id: workspace.data_user_id, is_workspace_identity: true }).del();
    });
  }

  static async purgeExpired(retentionDays, now = new Date()) {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const expired = await knex('client_workspaces')
      .whereNotNull('archived_at')
      .where('archived_at', '<', cutoff)
      .pluck('id');
    for (const id of expired) await ClientWorkspace.purge(id);
    return expired.length;
  }

  static async listMembers(id, userId) {
    await ClientWorkspace.getOwnedOrFail(id, userId);
    const rows = await knex('client_workspace_members as m')
      .join('users as u', 'u.id', 'm.user_id')
      .where('m.workspace_id', id)
      .select('u.id', 'u.email', 'u.first_name', 'u.last_name', 'm.role', 'm.joined_at')
      .orderBy('u.email', 'asc');
    return rows.map((row) => ({
      userId: row.id,
      email: row.email,
      name: [row.first_name, row.last_name].filter(Boolean).join(' '),
      role: row.role,
      joinedAt: row.joined_at,
    }));
  }

  static async addMember(id, userId, { email, role }) {
    await ClientWorkspace.getOwnedOrFail(id, userId);
    const user = await knex('users')
      .where({ email: email.toLowerCase(), is_workspace_identity: false, is_active: true })
      .first();
    if (!user) throw new NotFoundError('User not found', 'USER_NOT_FOUND');
    const existing = await knex('client_workspace_members').where({ workspace_id: id, user_id: user.id }).first();
    if (existing) throw new ConflictError('User is already linked to this client', 'MEMBER_EXISTS');
    await knex('client_workspace_members').insert({ id: generateId(), workspace_id: id, user_id: user.id, role });
    return ClientWorkspace.listMembers(id, userId);
  }

  static async ensureAnotherOwner(id, memberUserId) {
    const owners = await knex('client_workspace_members')
      .where({ workspace_id: id, role: 'owner' })
      .whereNot('user_id', memberUserId)
      .count('* as count')
      .first();
    if (Number(owners?.count || 0) === 0) {
      throw new BadRequestError('A client needs at least one owner', 'LAST_OWNER');
    }
  }

  static async updateMemberRole(id, userId, memberUserId, role) {
    await ClientWorkspace.getOwnedOrFail(id, userId);
    const member = await knex('client_workspace_members').where({ workspace_id: id, user_id: memberUserId }).first();
    if (!member) throw new NotFoundError('Member not found', 'MEMBER_NOT_FOUND');
    if (member.role === 'owner' && role !== 'owner') await ClientWorkspace.ensureAnotherOwner(id, memberUserId);
    await knex('client_workspace_members').where({ id: member.id }).update({ role });
    return ClientWorkspace.listMembers(id, userId);
  }

  static async removeMember(id, userId, memberUserId) {
    await ClientWorkspace.getOwnedOrFail(id, userId);
    const member = await knex('client_workspace_members').where({ workspace_id: id, user_id: memberUserId }).first();
    if (!member) throw new NotFoundError('Member not found', 'MEMBER_NOT_FOUND');
    if (member.role === 'owner') await ClientWorkspace.ensureAnotherOwner(id, memberUserId);
    await knex('client_workspace_members').where({ id: member.id }).del();
    return ClientWorkspace.listMembers(id, userId);
  }

  static async getAccessibleOrFail(id, userId) {
    const workspace = await ClientWorkspace.findAccessible(id, userId);
    if (!workspace) throw new ForbiddenError('Workspace access denied', 'WORKSPACE_FORBIDDEN');
    const row = await knex('client_workspaces').where('id', id).first();
    return { ...workspace, dataUserId: row.data_user_id };
  }

  /** Without an explicit choice, the user works in their personal space. */
  static async resolveContext(id, userId) {
    const workspaceId = id || (await ClientWorkspace.ensurePersonal(userId)).id;
    return ClientWorkspace.getAccessibleOrFail(workspaceId, userId);
  }
}
