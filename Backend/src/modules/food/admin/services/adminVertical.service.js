import { prisma } from '../../../../config/prisma.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { isId } from '../../../../utils/helpers.js';
import { invalidateCache } from '../../../../middleware/cache.js';
import { verticalSlug, restaurantVerticalWhere } from '../../shared/verticals.js';
import { localizeRow } from '../../shared/language.js';

/**
 * Business verticals (Food, Home Food, Grocery ...), managed by admin.
 *
 * Deleting follows the cuisine rule: a vertical restaurants still trade under
 * is switched off rather than removed, so their verticalIds never point at a
 * row that no longer exists. The default vertical cannot be deleted or switched
 * off -- it is where restaurants with no vertical live.
 */

const serialize = (row, restaurantCount = 0) => ({
    id: row.id,
    _id: row.id,
    name: row.name,
    nameTe: row.nameTe || '',
    slug: row.slug,
    description: row.description || '',
    image: row.image || null,
    isDefault: row.isDefault,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    restaurantCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
});

const dropCaches = () =>
    Promise.all(['verticals*', 'restaurants*', 'categories*'].map((p) => invalidateCache(p).catch(() => {})));

const countRestaurants = (vertical) =>
    prisma.foodRestaurant.count({ where: restaurantVerticalWhere(vertical) });

const cleanText = (value, max, label) => {
    const text = String(value ?? '').trim();
    if (text.length > max) throw new ValidationError(`${label} is too long (max ${max} characters)`);
    return text;
};

const sortOrderOf = (value) => (Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0);

export async function listVerticals(query = {}) {
    const includeInactive = query.includeInactive === true || query.includeInactive === 'true';
    const rows = await prisma.foodVertical.findMany({
        where: includeInactive ? {} : { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const counts = await Promise.all(rows.map(countRestaurants));
    return { verticals: rows.map((row, i) => serialize(row, counts[i])) };
}

/** What the apps get: active verticals only, in the requested language. */
export async function listPublicVerticals(lang = 'en') {
    const rows = await prisma.foodVertical.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
            id: true, name: true, nameTe: true, slug: true, description: true,
            image: true, isDefault: true, sortOrder: true,
        },
    });
    return { verticals: rows.map((row) => ({ ...localizeRow(row, lang), _id: row.id, image: row.image || null })) };
}

export async function createVertical(body = {}) {
    const name = cleanText(body.name, 60, 'Vertical name');
    if (!name) throw new ValidationError('Vertical name is required');
    const slug = verticalSlug(name);

    const clash = await prisma.foodVertical.findUnique({ where: { slug } });
    if (clash) throw new ValidationError(`"${clash.name}" already exists`);

    const isDefault = body.isDefault === true;
    const row = await prisma.$transaction(async (tx) => {
        if (isDefault) await tx.foodVertical.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
        return tx.foodVertical.create({
            data: {
                name,
                slug,
                nameTe: cleanText(body.nameTe, 60, 'Telugu name'),
                description: cleanText(body.description, 300, 'Description'),
                image: String(body.image ?? '').trim() || null,
                isDefault,
                isActive: isDefault ? true : body.isActive !== false,
                sortOrder: sortOrderOf(body.sortOrder),
            },
        });
    });
    await dropCaches();
    return { vertical: serialize(row, 0) };
}

export async function updateVertical(id, body = {}) {
    if (!isId(id)) throw new ValidationError('Vertical not found');
    const existing = await prisma.foodVertical.findUnique({ where: { id: String(id) } });
    if (!existing) throw new ValidationError('Vertical not found');

    const data = {};
    if (body.name !== undefined) {
        const name = cleanText(body.name, 60, 'Vertical name');
        if (!name) throw new ValidationError('Vertical name is required');
        const slug = verticalSlug(name);
        if (slug !== existing.slug) {
            const clash = await prisma.foodVertical.findUnique({ where: { slug } });
            if (clash) throw new ValidationError(`"${clash.name}" already exists`);
        }
        data.name = name;
        data.slug = slug;
    }
    if (body.nameTe !== undefined) data.nameTe = cleanText(body.nameTe, 60, 'Telugu name');
    if (body.description !== undefined) data.description = cleanText(body.description, 300, 'Description');
    if (body.image !== undefined) data.image = String(body.image ?? '').trim() || null;
    if (body.sortOrder !== undefined) data.sortOrder = sortOrderOf(body.sortOrder);

    if (body.isActive !== undefined) {
        const active = body.isActive !== false;
        if (!active && existing.isDefault) {
            throw new ValidationError('The default vertical cannot be switched off. Make another vertical the default first.');
        }
        data.isActive = active;
    }

    const makeDefault = body.isDefault === true && !existing.isDefault;
    if (body.isDefault === false && existing.isDefault) {
        throw new ValidationError('Pick another vertical as the default instead; there must always be one.');
    }

    const row = await prisma.$transaction(async (tx) => {
        if (makeDefault) {
            await tx.foodVertical.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
            data.isDefault = true;
            data.isActive = true;
        }
        return tx.foodVertical.update({ where: { id: existing.id }, data });
    });
    await dropCaches();
    return { vertical: serialize(row, await countRestaurants(row)) };
}

export async function deleteVertical(id) {
    if (!isId(id)) throw new ValidationError('Vertical not found');
    const existing = await prisma.foodVertical.findUnique({ where: { id: String(id) } });
    if (!existing) throw new ValidationError('Vertical not found');
    if (existing.isDefault) {
        throw new ValidationError('The default vertical cannot be deleted. Make another vertical the default first.');
    }

    const uses = await countRestaurants(existing);
    if (uses > 0) {
        const row = await prisma.foodVertical.update({ where: { id: existing.id }, data: { isActive: false } });
        await dropCaches();
        return {
            deleted: false,
            deactivated: true,
            restaurantCount: uses,
            vertical: serialize(row, uses),
            message: `${existing.name} is used by ${uses} restaurant${uses === 1 ? '' : 's'}, so it was switched off rather than deleted.`,
        };
    }

    await prisma.$transaction([
        // Categories and products that pointed at it fall back to "no vertical".
        prisma.foodCategory.updateMany({ where: { verticalId: existing.id }, data: { verticalId: null } }),
        prisma.foodItem.updateMany({ where: { verticalId: existing.id }, data: { verticalId: null } }),
        prisma.foodVertical.delete({ where: { id: existing.id } }),
    ]);
    await dropCaches();
    return { deleted: true, deactivated: false, restaurantCount: 0 };
}

/**
 * Replace a restaurant's verticals. An empty list puts it back in the default
 * vertical. Unknown or switched-off verticals are refused rather than dropped,
 * so a typo in the admin panel is an error, not a silent change.
 */
export async function setRestaurantVerticals(restaurantId, body = {}) {
    if (!isId(restaurantId)) throw new ValidationError('Restaurant not found');
    const restaurant = await prisma.foodRestaurant.findUnique({
        where: { id: String(restaurantId) },
        select: { id: true },
    });
    if (!restaurant) throw new ValidationError('Restaurant not found');

    const raw = Array.isArray(body.verticalIds) ? body.verticalIds : null;
    if (!raw) throw new ValidationError('verticalIds must be a list');
    const ids = [...new Set(raw.map((v) => String(v ?? '').trim()).filter(Boolean))];
    if (ids.length > 20) throw new ValidationError('Too many verticals');
    if (ids.some((v) => !isId(v))) throw new ValidationError('Unknown vertical');

    if (ids.length) {
        const found = await prisma.foodVertical.findMany({
            where: { id: { in: ids }, isActive: true },
            select: { id: true },
        });
        if (found.length !== ids.length) throw new ValidationError('Unknown or switched-off vertical');
    }

    const updated = await prisma.foodRestaurant.update({
        where: { id: restaurant.id },
        data: { verticalIds: ids },
        select: { id: true, restaurantName: true, verticalIds: true },
    });
    await dropCaches();
    return { restaurant: updated };
}
