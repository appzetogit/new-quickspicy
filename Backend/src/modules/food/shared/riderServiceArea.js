import { prisma } from '../../../config/prisma.js';
import { isId } from '../../../utils/helpers.js';

/**
 * Which riders may serve a zone.
 *
 * A rider serves their home zone (FoodDeliveryPartner.zoneId) plus the zones of
 * their cohort, when that cohort is active. Dispatch only applies this to zones
 * an admin has switched to "riders from this zone only"
 * (FoodZone.ridersFromZoneOnly); every other zone keeps going purely by
 * distance, as before.
 */

/** True when the zone only takes riders who serve it. */
export async function zoneRestrictsRiders(zoneId) {
    if (!isId(zoneId)) return false;
    const zone = await prisma.foodZone.findUnique({
        where: { id: String(zoneId) },
        select: { ridersFromZoneOnly: true },
    });
    return Boolean(zone?.ridersFromZoneOnly);
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
        select: { id: true, zoneId: true, cohortId: true },
    });
    const cohortIds = [...new Set(riders.map((r) => r.cohortId).filter(Boolean))];
    const cohorts = cohortIds.length
        ? await prisma.foodRiderCohort.findMany({
            where: { id: { in: cohortIds }, isActive: true },
            select: { id: true, zoneIds: true },
        })
        : [];
    const cohortZones = new Map(cohorts.map((c) => [c.id, new Set(c.zoneIds || [])]));
    const target = String(zoneId);

    const outside = new Set(ids);
    for (const rider of riders) {
        if (rider.zoneId === target || cohortZones.get(rider.cohortId)?.has(target)) {
            outside.delete(rider.id);
        }
    }
    return outside;
}
