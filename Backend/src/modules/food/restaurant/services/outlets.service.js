import { prisma } from '../../../../config/prisma.js';
import { isId } from '../../../../utils/helpers.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { invalidateCache } from '../../../../middleware/cache.js';
import { restaurantsInReach } from '../../shared/deliveryRadius.js';
import { findApprovedRestaurant } from './restaurantLookup.helper.js';
import { restaurantCards } from '../../search/services/dishSearch.service.js';

/**
 * Outlets: several restaurants that are branches of one brand.
 *
 * They share `outletGroupId` -- the id of the outlet the group was started
 * from. A restaurant with no group, or alone in one, has no other outlets, and
 * the app hides its "other outlets" button.
 */

const dropCaches = () =>
    Promise.all(['restaurants*', 'restaurant_detail*', 'restaurant_outlets*'].map((p) => invalidateCache(p).catch(() => {})));

const groupMembers = (groupId) =>
    prisma.foodRestaurant.findMany({
        where: { outletGroupId: groupId },
        select: { id: true, restaurantName: true, area: true, city: true, status: true },
        orderBy: { restaurantName: 'asc' },
    });

/**
 * Admin: make `restaurantId` and `outletIds` outlets of one brand. Restaurants
 * already in another group are moved into this one.
 */
export async function linkOutlets(restaurantId, body = {}) {
    if (!isId(restaurantId)) throw new ValidationError('Restaurant not found');
    const raw = Array.isArray(body.outletIds) ? body.outletIds : null;
    if (!raw || !raw.length) throw new ValidationError('outletIds must be a non-empty list');
    const ids = [...new Set(raw.map((v) => String(v ?? '').trim()))].filter((id) => id !== String(restaurantId));
    if (!ids.length) throw new ValidationError('Pick at least one other restaurant');
    if (ids.length > 200) throw new ValidationError('Too many outlets at once');
    if (ids.some((id) => !isId(id))) throw new ValidationError('Unknown restaurant');

    const main = await prisma.foodRestaurant.findUnique({
        where: { id: String(restaurantId) },
        select: { id: true, outletGroupId: true },
    });
    if (!main) throw new ValidationError('Restaurant not found');
    if ((await prisma.foodRestaurant.count({ where: { id: { in: ids } } })) !== ids.length) {
        throw new ValidationError('Unknown restaurant');
    }

    const groupId = main.outletGroupId || main.id;
    await prisma.foodRestaurant.updateMany({
        where: { id: { in: [main.id, ...ids] } },
        data: { outletGroupId: groupId },
    });
    await dropCaches();
    return { outletGroupId: groupId, outlets: await groupMembers(groupId) };
}

/** Admin: take one restaurant out of its group. A group left with one member is dissolved. */
export async function unlinkOutlet(restaurantId) {
    if (!isId(restaurantId)) throw new ValidationError('Restaurant not found');
    const row = await prisma.foodRestaurant.findUnique({
        where: { id: String(restaurantId) },
        select: { id: true, outletGroupId: true },
    });
    if (!row) throw new ValidationError('Restaurant not found');
    if (!row.outletGroupId) return { outletGroupId: null, outlets: [] };

    const groupId = row.outletGroupId;
    await prisma.foodRestaurant.update({ where: { id: row.id }, data: { outletGroupId: null } });
    const left = await groupMembers(groupId);
    if (left.length === 1) {
        await prisma.foodRestaurant.update({ where: { id: left[0].id }, data: { outletGroupId: null } });
    }
    await dropCaches();
    return { outletGroupId: left.length > 1 ? groupId : null, outlets: left.length > 1 ? left : [] };
}

/**
 * Public: a restaurant's other approved outlets, nearest first, with whether
 * each delivers to the customer (`inReach`) when a location is sent.
 */
export async function getOtherOutlets(restaurantIdOrSlug, query = {}) {
    const restaurant = await findApprovedRestaurant(restaurantIdOrSlug);
    if (!restaurant?.id) return null;
    const self = await prisma.foodRestaurant.findUnique({
        where: { id: restaurant.id },
        select: { outletGroupId: true },
    });
    if (!self?.outletGroupId) return { outletGroupId: null, outlets: [] };

    const siblings = await prisma.foodRestaurant.findMany({
        where: { outletGroupId: self.outletGroupId, status: 'approved', id: { not: restaurant.id } },
        select: { id: true, area: true, city: true, formattedAddress: true, latitude: true, longitude: true },
    });
    if (!siblings.length) return { outletGroupId: self.outletGroupId, outlets: [] };

    const reach = await restaurantsInReach({ lat: query.lat, lng: query.lng, radiusKm: query.radiusKm });
    const distanceById = reach.requiresLocation ? null : reach.distanceById;
    const cards = await restaurantCards(siblings.map((s) => s.id), distanceById);
    const where = new Map(siblings.map((s) => [s.id, s]));

    const outlets = [...cards.values()]
        .map((card) => ({
            ...card,
            area: where.get(card.id)?.area || '',
            city: where.get(card.id)?.city || '',
            address: where.get(card.id)?.formattedAddress || '',
            inReach: distanceById ? distanceById.has(card.id) : null,
        }))
        .sort((a, b) =>
            Number(b.inReach === true) - Number(a.inReach === true)
            || Number(b.isOpenNow) - Number(a.isOpenNow)
            || (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    return { outletGroupId: self.outletGroupId, outlets };
}

/**
 * How many other approved outlets each restaurant has, for the list cards.
 * Restaurants not in a group get 0.
 */
export async function otherOutletCounts(rows) {
    const groups = [...new Set(rows.map((r) => r.outletGroupId).filter(Boolean))];
    if (!groups.length) return new Map();
    const counted = await prisma.foodRestaurant.groupBy({
        by: ['outletGroupId'],
        where: { outletGroupId: { in: groups }, status: 'approved' },
        _count: { _all: true },
    });
    const perGroup = new Map(counted.map((c) => [c.outletGroupId, c._count._all]));
    return new Map(rows.map((r) => [r.id, r.outletGroupId ? Math.max(0, (perGroup.get(r.outletGroupId) || 1) - 1) : 0]));
}
