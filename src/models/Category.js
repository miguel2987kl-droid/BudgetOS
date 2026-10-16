import knex from '../database/connection.js';
import { generateId } from '../utils/helpers.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import { buildUpdates } from '../utils/modelHelpers.js';

export class Category {
  static async create(userId, data) {
    const id = generateId();
    await knex('categories').insert({
      id, user_id: userId, parent_id: data.parentId || null,
      name: data.name, type: data.type,
      icon: data.icon || 'tag', color: data.color || '#6B7280',
      budget_monthly: data.budgetMonthly || null, sort_order: data.sortOrder || 0,
    });
    return Category.findById(id, userId);
  }

  static async findById(id, userId) {
    const category = await knex('categories as c')
      .leftJoin('categories as p', 'c.parent_id', 'p.id')
      .select('c.*', 'p.name as parent_name')
      .where('c.id', id)
      .where(function () {
        this.where('c.user_id', userId).orWhereNull('c.user_id');
      })
      .where('c.is_active', true)
      .first();
    return category ? Category.format(category) : null;
  }

  static async findByIdOrFail(id, userId) {
    const category = await Category.findById(id, userId);
    if (!category) throw new NotFoundError('Category not found', 'CATEGORY_NOT_FOUND');
    return category;
  }

  static async findByUser(userId, options = {}) {
    const { type, parentId, isActive = true, includeSystem = true, flat = false } = options;

    let query = knex('categories as c')
      .leftJoin('categories as p', 'c.parent_id', 'p.id')
      .select('c.*', 'p.name as parent_name')
      .where(function () {
        this.where('c.user_id', userId).orWhereNull('c.user_id');
      });

    if (!includeSystem) query = query.where('c.is_system', false);
    if (type) query = query.where('c.type', type);
    if (parentId !== undefined) {
      query = parentId === null
        ? query.whereNull('c.parent_id')
        : query.where('c.parent_id', parentId);
    }
    if (isActive !== undefined) query = query.where('c.is_active', isActive);

    const categories = (await query.orderBy('c.sort_order', 'asc').orderBy('c.name', 'asc'))
      .map(Category.format);
    return flat ? categories : Category.buildTree(categories);
  }

  static buildTree(categories) {
    const map = new Map();
    const tree = [];
    categories.forEach(cat => map.set(cat.id, { ...cat, children: [] }));
    categories.forEach(cat => {
      const node = map.get(cat.id);
      if (cat.parentId && map.has(cat.parentId)) map.get(cat.parentId).children.push(node);
      else tree.push(node);
    });
    return tree;
  }

  static async update(id, userId, data) {
    const category = await Category.findByIdOrFail(id, userId);

    // Protected categories keep their name and type so the module can find them.
    const fields = category.isProtected
      ? ['parent_id', 'icon', 'color', 'budget_monthly', 'sort_order']
      : ['parent_id', 'name', 'type', 'icon', 'color', 'budget_monthly', 'sort_order'];
    const updates = buildUpdates(data, fields);

    if (Object.keys(updates).length > 0) {
      await knex('categories').where({ id, user_id: userId }).update(updates);
    }
    return Category.findById(id, userId);
  }

  static async delete(id, userId) {
    const category = await Category.findByIdOrFail(id, userId);
    if (category.isProtected) {
      throw new BadRequestError('This category is required by the finance module', 'CATEGORY_PROTECTED');
    }
    const txCount = await knex('transactions').where('category_id', id).count('* as count').first();
    const count = txCount?.count || 0;

    if (count > 0) {
      await knex('categories').where({ id, user_id: userId }).update({ is_active: false });
    } else {
      await knex('categories').where({ id, user_id: userId }).del();
    }
    return { deleted: true, softDelete: count > 0 };
  }

  static format(category) {
    return {
      id: category.id, userId: category.user_id, parentId: category.parent_id,
      parentName: category.parent_name, name: category.name, type: category.type,
      icon: category.icon, color: category.color, isSystem: Boolean(category.is_system),
      isProtected: Boolean(category.is_protected),
      isActive: Boolean(category.is_active), budgetMonthly: category.budget_monthly,
      sortOrder: category.sort_order, createdAt: category.created_at, updatedAt: category.updated_at,
    };
  }
}

export default Category;
