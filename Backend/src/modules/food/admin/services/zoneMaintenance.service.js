import { prisma } from '../../../../config/prisma.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { isId } from '../../../../utils/helpers.js';

/**
 * Maintenance mode by zone: take every restaurant in a zone offline in one go,
 * and later bring back exactly the ones that were online before.
 *
 * Which restaurants were switched off is kept in food_platform_settings under
 * one key, { [zoneId]: { restaurantIds, at, by } }, so "bring back online" does
 * not wake a restaurant that was already offline (closed by its owner, or by an
 * admin for some other reason) before the zone went down.
 */

export const ZONE_MAINTENANCE_KEY = 'zone_maintenance';

const readAll = async (db = prisma) => {
    const row = await db.foodPlatformSetting.findUnique({ where: { key: ZONE_MAINTENANCE_KEY } });
    const value = row?.value;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
};

const writeAll = (db, value) => db.foodPlatformSetting.upsert({
    where: { key: ZONE_MAINTENANCE_KEY },
    create: { key: ZONE_MAINTENANCE_KEY, value },
    update: { value },
});

const checkZone = async (zoneId) => {
    if (!isId(zoneId)) throw new ValidationError('Pick a zone');
    const zone = await prisma.foodZone.findUnique({ where: { id: String(zoneId) }, select: { id: true, name: true, zoneName: true } });
    if (!zone) throw new ValidationError('Zone not found');
    return zone;
};

const invalidatePublicCaches = async () => {
    try {
        const { invalidateCache } = await import('../../../../middleware/cache.js');
        void invalidateCache('restaurants:*');
        void invalidateCache('restaurant_detail:*');
        void invalidateCache('restaurant_timings:*');
    } catch {
        // Caches expire on their own within a minute.
    }
};

/** Counts for the confirm dialog, and whether the zone is in maintenance now. */
export async function getZoneMaintenance(zoneId) {
    const zone = await checkZone(zoneId);
    const where = { zoneId: zone.id, status: 'approved' };
    const [total, online, all] = await Promise.all([
        prisma.foodRestaurant.count({ where }),
        prisma.foodRestaurant.count({ where: { ...where, isAcceptingOrders: true, offlineByAdmin: false } }),
        readAll(),
    ]);
    const entry = all[zone.id];
    return {
        zoneId: zone.id,
        zoneName: zone.name || zone.zoneName || '',
        total,
        online,
        offline: total - online,
        inMaintenance: Boolean(entry),
        takenOfflineCount: entry?.restaurantIds?.length || 0,
        takenOfflineAt: entry?.at || null,
    };
}

/**
 * Take every online approved restaurant in the zone offline (admin offline:
 * the restaurant app cannot switch itself back on). Taking the zone offline
 * again adds any restaurant that came online since to the saved list.
 */
export async function takeZoneOffline(zoneId, adminId = null) {
    const zone = await checkZone(zoneId);
    const result = await prisma.$transaction(async (tx) => {
        const rows = await tx.foodRestaurant.findMany({
            where: { zoneId: zone.id, status: 'approved', isAcceptingOrders: true, offlineByAdmin: false },
            select: { id: true },
        });
        const ids = rows.map((r) => r.id);
        if (ids.length) {
            await tx.foodRestaurant.updateMany({
                where: { id: { in: ids }, zoneId: zone.id },
                data: { isAcceptingOrders: false, offlineByAdmin: true },
            });
        }
        const all = await readAll(tx);
        const before = Array.isArray(all[zone.id]?.restaurantIds) ? all[zone.id].restaurantIds : [];
        all[zone.id] = {
            restaurantIds: [...new Set([...before, ...ids])],
            at: all[zone.id]?.at || new Date().toISOString(),
            by: adminId ? String(adminId) : null,
        };
        await writeAll(tx, all);
        return { changed: ids.length, tracked: all[zone.id].restaurantIds.length };
    });
    await invalidatePublicCaches();
    return { zoneId: zone.id, takenOffline: result.changed, inMaintenance: true, trackedCount: result.tracked };
}

/**
 * Bring back online only the restaurants this zone's maintenance switched off
 * (and that are still in the zone and still admin-offline). Restaurants that
 * were offline before stay offline.
 */
export async function bringZoneOnline(zoneId) {
    const zone = await checkZone(zoneId);
    const result = await prisma.$transaction(async (tx) => {
        const all = await readAll(tx);
        const ids = Array.isArray(all[zone.id]?.restaurantIds) ? all[zone.id].restaurantIds.filter(isId) : [];
        let count = 0;
        if (ids.length) {
            const res = await tx.foodRestaurant.updateMany({
                where: { id: { in: ids }, zoneId: zone.id, offlineByAdmin: true },
                data: { isAcceptingOrders: true, offlineByAdmin: false, outsideHoursOverride: false },
            });
            count = res.count;
        }
        const hadEntry = Boolean(all[zone.id]);
        delete all[zone.id];
        if (hadEntry) await writeAll(tx, all);
        return { count, hadEntry };
    });
    await invalidatePublicCaches();
    return { zoneId: zone.id, broughtOnline: result.count, inMaintenance: false, wasInMaintenance: result.hadEntry };
}
