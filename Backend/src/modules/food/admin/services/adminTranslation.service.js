import { prisma } from '../../../../config/prisma.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { isId } from '../../../../utils/helpers.js';
import { invalidateCache } from '../../../../middleware/cache.js';

/**
 * Telugu text for what customers read: dishes, categories and verticals.
 *
 * Kept as its own small API rather than new fields on every create/edit form:
 * translation is usually done in one sitting by one person, after the menu
 * exists, and "show me what is still untranslated" is the screen they need.
 */

const ENTITIES = {
    item: {
        model: () => prisma.foodItem,
        hasDescription: true,
        select: { id: true, name: true, nameTe: true, description: true, descriptionTe: true, restaurantId: true, categoryName: true },
    },
    category: {
        model: () => prisma.foodCategory,
        hasDescription: false,
        select: { id: true, name: true, nameTe: true, restaurantId: true },
    },
    vertical: {
        model: () => prisma.foodVertical,
        hasDescription: false,
        select: { id: true, name: true, nameTe: true },
    },
};

const entityOf = (name) => {
    const entity = ENTITIES[String(name ?? '').trim().toLowerCase()];
    if (!entity) throw new ValidationError('entity must be one of: item, category, vertical');
    return entity;
};

const cleanTelugu = (value, max, label) => {
    const text = String(value ?? '').trim();
    if (text.length > max) throw new ValidationError(`${label} is too long (max ${max} characters)`);
    return text;
};

const dropCaches = () =>
    Promise.all(['restaurant_menu*', 'restaurants*', 'categories*', 'verticals*'].map((p) => invalidateCache(p).catch(() => {})));

/**
 * Rows of one entity with their English and Telugu text.
 * `missing=true` lists only the untranslated ones.
 */
export async function listTranslations(query = {}) {
    const entity = entityOf(query.entity);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 500);
    const page = Math.max(parseInt(query.page, 10) || 1, 1);

    const AND = [];
    if (query.missing === 'true' || query.missing === true) {
        AND.push(entity.hasDescription
            ? { OR: [{ nameTe: '' }, { AND: [{ description: { not: '' } }, { descriptionTe: '' }] }] }
            : { nameTe: '' });
    }
    const search = String(query.search ?? '').trim();
    if (search) AND.push({ name: { contains: search.slice(0, 80), mode: 'insensitive' } });
    if (query.restaurantId && entity !== ENTITIES.vertical) {
        if (!isId(query.restaurantId)) throw new ValidationError('Unknown restaurant');
        AND.push({ restaurantId: String(query.restaurantId) });
    }
    const where = AND.length ? { AND } : {};

    const model = entity.model();
    const [rows, total] = await Promise.all([
        model.findMany({ where, select: entity.select, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
        model.count({ where }),
    ]);
    return { entity: String(query.entity).toLowerCase(), items: rows, total, page, limit };
}

const buildUpdate = (entity, body) => {
    const data = {};
    if (body.nameTe !== undefined) data.nameTe = cleanTelugu(body.nameTe, 200, 'Telugu name');
    if (body.descriptionTe !== undefined) {
        if (!entity.hasDescription) throw new ValidationError('This entity has no description');
        data.descriptionTe = cleanTelugu(body.descriptionTe, 2000, 'Telugu description');
    }
    if (!Object.keys(data).length) throw new ValidationError('Send nameTe and/or descriptionTe');
    return data;
};

export async function updateTranslation(entityName, id, body = {}) {
    const entity = entityOf(entityName);
    if (!isId(id)) throw new ValidationError('Not found');
    const model = entity.model();
    const existing = await model.findUnique({ where: { id: String(id) }, select: { id: true } });
    if (!existing) throw new ValidationError('Not found');

    const row = await model.update({ where: { id: existing.id }, data: buildUpdate(entity, body), select: entity.select });
    await dropCaches();
    return { item: row };
}

/**
 * Many translations in one go: [{ entity, id, nameTe?, descriptionTe? }].
 * All-or-nothing, so a bad row in a spreadsheet paste does not leave half of it
 * applied.
 */
export async function bulkUpdateTranslations(body = {}) {
    const rows = Array.isArray(body.translations) ? body.translations : null;
    if (!rows || !rows.length) throw new ValidationError('translations must be a non-empty list');
    if (rows.length > 500) throw new ValidationError('Too many rows at once (max 500)');

    const ops = rows.map((row, i) => {
        const entity = entityOf(row?.entity);
        if (!isId(row?.id)) throw new ValidationError(`Row ${i + 1}: unknown id`);
        return { entity, id: String(row.id), data: buildUpdate(entity, row) };
    });

    // Check every id exists before writing anything.
    for (const [name, entity] of Object.entries(ENTITIES)) {
        const ids = [...new Set(ops.filter((o) => o.entity === entity).map((o) => o.id))];
        if (!ids.length) continue;
        const found = await entity.model().count({ where: { id: { in: ids } } });
        if (found !== ids.length) throw new ValidationError(`Some ${name} ids were not found`);
    }

    await prisma.$transaction(ops.map((o) => o.entity.model().update({ where: { id: o.id }, data: o.data })));
    await dropCaches();
    return { updated: ops.length };
}
