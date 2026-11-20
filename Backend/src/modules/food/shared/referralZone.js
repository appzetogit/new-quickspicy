import { prisma } from '../../../config/prisma.js';
import { isId } from '../../../utils/helpers.js';
import { findZoneForPoint } from './zone.service.js';

/**
 * Referral rewards and limits, per zone.
 *
 * FoodReferralSettings (the newest active row) stays the platform default. A
 * FoodReferralZoneSetting row for a zone overrides any field it sets; a null
 * field there means "use the default".
 *
 * Which zone a referral belongs to:
 *  - customer referral: the zone of the referred customer's saved address
 *    (default first, else oldest). Customer rewards are paid when the code is
 *    applied, usually at signup and before any order, so "zone of their first
 *    order" does not exist yet. Without an address, the referrer's address is
 *    used; without either, the global settings.
 *  - rider referral: the referred rider's home zone (zoneId), else the
 *    referrer's home zone, else global.
 */

const OVERRIDE_FIELDS = ['referralRewardUser', 'referralRewardDelivery', 'referralLimitUser', 'referralLimitDelivery'];

/** Global settings with a zone row's non-null fields laid over them. Pure. */
export const mergeReferralSettings = (globalDoc, zoneDoc) => {
    if (!globalDoc && !zoneDoc) return null;
    const merged = { ...(globalDoc || {}) };
    if (zoneDoc && zoneDoc.isActive !== false) {
        for (const field of OVERRIDE_FIELDS) {
            if (zoneDoc[field] !== null && zoneDoc[field] !== undefined) merged[field] = zoneDoc[field];
        }
        merged.zoneId = zoneDoc.zoneId;
        merged.zoneOverride = true;
    }
    return merged;
};

export const loadGlobalReferralSettings = (db = prisma) =>
    db.foodReferralSettings.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'desc' } });

/**
 * Effective settings for a zone. Returns null when there is no global row --
 * the global row also switches referrals on at all, so a zone override alone
 * does not enable them.
 */
export async function loadReferralSettingsForZone(zoneId, db = prisma) {
    const [globalDoc, zoneDoc] = await Promise.all([
        loadGlobalReferralSettings(db),
        isId(zoneId)
            ? db.foodReferralZoneSetting.findUnique({ where: { zoneId: String(zoneId) } })
            : null,
    ]);
    if (!globalDoc) return null;
    return mergeReferralSettings(globalDoc, zoneDoc);
}

/** Zone of a customer's saved address: default first, else oldest. */
export async function zoneIdOfCustomer(userId) {
    if (!isId(userId)) return null;
    const addresses = await prisma.userAddress.findMany({
        where: { userId: String(userId), latitude: { not: null }, longitude: { not: null } },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: { latitude: true, longitude: true },
        take: 3,
    });
    for (const a of addresses) {
        const zone = await findZoneForPoint(a.latitude, a.longitude).catch(() => null);
        if (zone?.id) return zone.id;
    }
    return null;
}

/** Zone for a customer referral: the referred customer's, else the referrer's. */
export async function zoneIdForUserReferral(refereeId, referrerId) {
    return (await zoneIdOfCustomer(refereeId)) || (await zoneIdOfCustomer(referrerId)) || null;
}
