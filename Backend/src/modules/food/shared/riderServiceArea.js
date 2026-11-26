import { prisma } from '../../../config/prisma.js';
import { isId } from '../../../utils/helpers.js';
import { loadZoneTree } from './zoneHierarchy.js';

/**
 * Which riders may serve a zone.
 *
 * A rider serves their home zone (FoodDeliveryPartner.zoneId) plus their
 * serviceZoneIds (the small zones of their main zone they were given; this
 * replaced rider cohorts).
 *
 * Restricted zones only offer orders to riders who serve them:
 *  - every small zone (a zone with a main zone), always -- that is what a
 *    small zone is for, and orders are never widened to other small zones;
 *  - any other zone an admin switched to "riders from this zone only"
 *    (FoodZone.ridersFromZoneOnly).
 * Everything else goes purely by distance, as before.
 *
 * A main zone that is restricted takes riders serving it or any of its small
 * zones: a restaurant inside the main zone but outside every small zone is
 * nobody's small zone, so everyone in that main zone may take it.
 */

/** True when the zone only takes riders who serve it. */
export async function zoneRestrictsRiders(zoneId) {
    if (!isId(zoneId)) return false;
    const zone = await prisma.foodZone.findUnique({
        where: { id: String(zoneId) },
        select: { ridersFromZoneOnly: true, parentZoneId: true },
    });
    return Boolean(zone?.parentZoneId || zone?.ridersFromZoneOnly);
}

/** The zones whose riders count as serving `zoneId`. */
async function zonesThatServe(zoneId) {
    const id = String(zoneId);
    const byId = await loadZoneTree(id);
    const zone = byId.get(id);
    if (zone?.parentZoneId) return new Set([id]);
    const small = [...byId.values()].filter((z) => z.parentZoneId === id).map((z) => z.id);
    return new Set([id, ...small]);
}

/**
 * The ids, of those given, of riders who do not serve the zone. Empty when the
 * zone is not restricted, so callers can filter with it unconditionally.
 *
 * @param {string|null} zoneId
 * @param {string[]} partnerIds
 * @returns {Promise<Set<string>>}
 */
export async function ridersOutsideZone(zoneId, partnerIds = []) {
    const ids = [...new Set(partnerIds.map(String).filter(isId))];
    if (!ids.length || !(await zoneRestrictsRiders(zoneId))) return new Set();

    const riders = await prisma.foodDeliveryPartner.findMany({
        where: { id: { in: ids } },
        select: { id: true, zoneId: true, serviceZoneIds: true },
    });
    const accepted = await zonesThatServe(zoneId);

    const outside = new Set(ids);
    for (const rider of riders) {
        const serves = [rider.zoneId, ...(rider.serviceZoneIds || [])].filter(Boolean);
        if (serves.some((z) => accepted.has(z))) outside.delete(rider.id);
    }
    return outside;
}

/** Every zone a rider serves, home zone first. */
export function zonesOfRider(rider) {
    return [...new Set([rider?.zoneId, ...(rider?.serviceZoneIds || [])].filter(Boolean).map(String))];
}
