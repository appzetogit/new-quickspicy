import { prisma } from '../../../../config/prisma.js';
import { num, reportFilters } from './reportFilters.helpers.js';
import { fromFoodTypeColumn } from '../../shared/foodType.util.js';

/**
 * Inventory & stock: what each restaurant can sell right now.
 *
 * Counts approved dishes of approved restaurants. A dish is out of stock when
 * isAvailable is false -- except one whose stockResumeAt has already passed:
 * it is switched back on the next time its menu is read
 * (restoreExpiredFoodAvailability), so it is counted as available here.
 *
 * "Timed" out-of-stock dishes have a stockResumeAt in the future and come back
 * by themselves; the rest stay off until someone turns them on.
 *
 * There is no stock history table and no "went out of stock at" timestamp.
 * The item's updatedAt is shown as an approximation (it also moves on any
 * other edit), and historical stockout counts cannot be computed.
 */

const MAX_ITEMS = 2000;

const outOfStockWhere = (now) => ({
    isAvailable: false,
    OR: [{ stockResumeAt: null }, { stockResumeAt: { gt: now } }],
});

export async function getInventoryReport(query = {}) {
    const { zoneId, restaurantId } = reportFilters(query);
    const search = String(query.search || '').trim().slice(0, 60);
    const now = new Date();

    const base = {
        approvalStatus: 'approved',
        restaurant: { status: 'approved', ...(zoneId ? { zoneId } : {}) },
        ...(restaurantId ? { restaurantId } : {}),
    };
    const oos = { ...base, ...outOfStockWhere(now) };
    const timed = { ...base, isAvailable: false, stockResumeAt: { gt: now } };

    const [totalByRestaurant, oosByRestaurant, timedByRestaurant, items, oosCount] = await Promise.all([
        prisma.foodItem.groupBy({ by: ['restaurantId'], where: base, _count: { _all: true } }),
        prisma.foodItem.groupBy({ by: ['restaurantId'], where: oos, _count: { _all: true } }),
        prisma.foodItem.groupBy({ by: ['restaurantId'], where: timed, _count: { _all: true } }),
        prisma.foodItem.findMany({
            where: {
                ...oos,
                ...(search ? { AND: [{ OR: [
                    { name: { contains: search, mode: 'insensitive' } },
                    { restaurant: { restaurantName: { contains: search, mode: 'insensitive' } } },
                ] }] } : {}),
            },
            // Longest-untouched first: the likeliest to have been forgotten.
            orderBy: { updatedAt: 'asc' },
            take: MAX_ITEMS,
            select: {
                id: true, name: true, categoryName: true, price: true, foodType: true,
                stockOffMode: true, stockResumeAt: true, updatedAt: true, restaurantId: true,
                restaurant: { select: { restaurantName: true, zone: { select: { name: true, zoneName: true } } } },
            },
        }),
        prisma.foodItem.count({ where: oos }),
    ]);

    const countOf = (rows) => new Map(rows.map((r) => [r.restaurantId, r._count?._all || 0]));
    const oosMap = countOf(oosByRestaurant);
    const timedMap = countOf(timedByRestaurant);

    const ids = totalByRestaurant.map((r) => r.restaurantId);
    const restaurants = ids.length
        ? await prisma.foodRestaurant.findMany({
            where: { id: { in: ids } },
            select: {
                id: true, restaurantName: true, isAcceptingOrders: true, offlineByAdmin: true,
                zone: { select: { id: true, name: true, zoneName: true } },
            },
        })
        : [];
    const restaurantById = new Map(restaurants.map((r) => [r.id, r]));

    const restaurantRows = totalByRestaurant
        // The restaurant lookup is city-scoped; drop any it did not return.
        .filter((r) => restaurantById.has(r.restaurantId))
        .map((r) => {
            const info = restaurantById.get(r.restaurantId);
            const total = r._count?._all || 0;
            const outOfStock = oosMap.get(r.restaurantId) || 0;
            const timedResume = timedMap.get(r.restaurantId) || 0;
            return {
                restaurantId: r.restaurantId,
                restaurantName: info.restaurantName,
                zoneName: info.zone ? (info.zone.zoneName || info.zone.name) : '',
                online: Boolean(info.isAcceptingOrders) && !info.offlineByAdmin,
                totalItems: total,
                available: total - outOfStock,
                outOfStock,
                timedResume,
                manualOff: outOfStock - timedResume,
                outOfStockPct: total ? Math.round((outOfStock / total) * 1000) / 10 : 0,
            };
        })
        // A search keeps restaurants named like it, and those with a matching dish off.
        .filter((r) => !search
            || r.restaurantName.toLowerCase().includes(search.toLowerCase())
            || items.some((i) => i.restaurantId === r.restaurantId))
        .sort((a, b) => b.outOfStock - a.outOfStock || b.outOfStockPct - a.outOfStockPct);

    const sum = (key) => restaurantRows.reduce((s, r) => s + r[key], 0);
    const totalItems = sum('totalItems');
    const outOfStock = sum('outOfStock');

    return {
        summary: {
            restaurants: restaurantRows.length,
            restaurantsWithStockouts: restaurantRows.filter((r) => r.outOfStock > 0).length,
            totalItems,
            available: sum('available'),
            outOfStock,
            timedResume: sum('timedResume'),
            manualOff: sum('manualOff'),
            outOfStockPct: totalItems ? Math.round((outOfStock / totalItems) * 1000) / 10 : 0,
        },
        restaurants: restaurantRows,
        outOfStockItems: items
            .filter((i) => restaurantById.has(i.restaurantId))
            .map((i) => ({
                id: i.id,
                name: i.name,
                categoryName: i.categoryName || '',
                price: num(i.price),
                foodType: fromFoodTypeColumn(i.foodType), // Veg | Egg | Non-Veg
                restaurantId: i.restaurantId,
                restaurantName: i.restaurant?.restaurantName || 'Unknown restaurant',
                zoneName: i.restaurant?.zone ? (i.restaurant.zone.zoneName || i.restaurant.zone.name) : '',
                stockOffMode: i.stockOffMode || 'manual',
                resumesAt: i.stockResumeAt,
                lastUpdatedAt: i.updatedAt,
            })),
        pagination: { total: oosCount, returned: items.length, truncated: oosCount > items.length },
        history: null,
        notes: [
            'No stock history is stored, so past stockout counts cannot be shown. "Last updated" is the dish\'s last edit of any kind, an approximation of when it went out of stock.',
            'Dishes whose resume time has passed are counted as available: they switch back on when the menu is next opened.',
        ],
    };
}
