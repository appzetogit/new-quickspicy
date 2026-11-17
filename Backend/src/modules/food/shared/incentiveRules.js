/**
 * Rules for rider incentives (FoodEarningAddon), shared by the completion sweep
 * that grants them and the rider app's progress screen, so the two never
 * disagree about what counts.
 *
 * Pure functions: no database access here.
 */

const IST_OFFSET_MS = 330 * 60000;
const DAY_MS = 24 * 3600000;

export const RECURRENCES = ['none', 'daily', 'weekly'];

export const normalizeRecurrence = (value) =>
    RECURRENCES.includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'none';

/** Midnight IST of the day `at` falls on, as a real instant. */
export function istDayStart(at = new Date()) {
    const ist = new Date(new Date(at).getTime() + IST_OFFSET_MS);
    ist.setUTCHours(0, 0, 0, 0);
    return new Date(ist.getTime() - IST_OFFSET_MS);
}

/** Monday 00:00 IST of the week `at` falls in. */
export function istWeekStart(at = new Date()) {
    const dayStart = istDayStart(at);
    const weekday = new Date(dayStart.getTime() + IST_OFFSET_MS).getUTCDay(); // 0 = Sunday
    const sinceMonday = (weekday + 6) % 7;
    return new Date(dayStart.getTime() - sinceMonday * DAY_MS);
}

/** "YYYY-MM-DD" of an IST midnight. */
export const istDateKey = (instant) => new Date(new Date(instant).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/**
 * The run of the offer that `at` falls in: { key, start, end }, clipped to the
 * offer's own dates. Null when `at` is outside the offer.
 *
 * A one-off offer has one run, key "". A daily or weekly one has a run per IST
 * day / Monday-to-Sunday week, keyed by its first day.
 */
export function offerPeriod(offer, at = new Date()) {
    const now = new Date(at).getTime();
    const offerStart = new Date(offer.startDate).getTime();
    const offerEnd = new Date(offer.endDate).getTime();
    if (!(now >= offerStart && now <= offerEnd)) return null;

    const recurrence = normalizeRecurrence(offer.recurrence);
    if (recurrence === 'none') {
        return { key: '', start: new Date(offerStart), end: new Date(offerEnd) };
    }
    const runStart = recurrence === 'daily' ? istDayStart(now) : istWeekStart(now);
    const runEnd = new Date(runStart.getTime() + (recurrence === 'daily' ? DAY_MS : 7 * DAY_MS) - 1);
    return {
        key: istDateKey(runStart),
        start: new Date(Math.max(runStart.getTime(), offerStart)),
        end: new Date(Math.min(runEnd.getTime(), offerEnd)),
    };
}

/**
 * The targets of an offer, lowest first: [{ tier, requiredOrders,
 * requiredOnlineMinutes, earningAmount }]. Tier 0 is the offer's own single
 * target; slabs are tiers 1..n.
 */
export function offerTargets(offer) {
    const slabs = offer.criteria === 'orders' && Array.isArray(offer.tiers) ? offer.tiers : [];
    const clean = slabs
        .map((s) => ({ requiredOrders: Math.trunc(Number(s?.requiredOrders)), earningAmount: Number(s?.earningAmount) }))
        .filter((s) => s.requiredOrders > 0 && Number.isFinite(s.earningAmount) && s.earningAmount >= 0)
        .sort((a, b) => a.requiredOrders - b.requiredOrders);
    if (clean.length) {
        return clean.map((s, i) => ({ tier: i + 1, requiredOrders: s.requiredOrders, requiredOnlineMinutes: 0, earningAmount: s.earningAmount }));
    }
    return [{
        tier: 0,
        requiredOrders: Number(offer.requiredOrders) || 0,
        requiredOnlineMinutes: Number(offer.requiredOnlineMinutes) || 0,
        earningAmount: Number(offer.earningAmount) || 0,
    }];
}

/** periodKey stored on a grant: the run key, plus "#t<n>" for a slab. */
export const grantKey = (periodKey, tier) => (tier > 0 ? `${periodKey}#t${tier}` : periodKey);

/** Whether a target is met. A zero target is treated as 1, never as free money. */
export function targetMet(offer, target, { orders = 0, onlineMinutes = 0 } = {}) {
    if (offer.criteria === 'online_hours') return onlineMinutes >= (target.requiredOnlineMinutes || 1);
    return orders >= (target.requiredOrders || 1);
}

/**
 * Whether the offer is for this rider.
 *
 * @param offer  { zoneIds, cohortIds }
 * @param rider  { zoneId, cohortId }
 * @param cohortZoneIds  zones of the rider's cohort if it is active, else []
 */
export function riderTargeted(offer, rider, cohortZoneIds = []) {
    const zoneIds = offer.zoneIds || [];
    const cohortIds = offer.cohortIds || [];
    if (cohortIds.length && !cohortIds.includes(rider?.cohortId)) return false;
    if (zoneIds.length) {
        const serves = [rider?.zoneId, ...cohortZoneIds].filter(Boolean);
        if (!serves.some((z) => zoneIds.includes(z))) return false;
    }
    return true;
}

/** Checks and tidies the admin's slabs. Throws a message string on bad input. */
export function cleanTiers(value) {
    if (value === undefined) return undefined;
    if (value === null) return [];
    if (!Array.isArray(value)) throw 'tiers must be a list';
    if (value.length > 10) throw 'At most 10 slabs';
    const tiers = value.map((s) => ({
        requiredOrders: Math.trunc(Number(s?.requiredOrders)),
        earningAmount: Math.round(Number(s?.earningAmount) * 100) / 100,
    }));
    for (const t of tiers) {
        if (!(t.requiredOrders > 0)) throw 'Each slab needs requiredOrders above 0';
        if (!(t.earningAmount >= 0)) throw 'Each slab needs an earningAmount of 0 or more';
    }
    tiers.sort((a, b) => a.requiredOrders - b.requiredOrders);
    if (new Set(tiers.map((t) => t.requiredOrders)).size !== tiers.length) throw 'Two slabs have the same order target';
    return tiers;
}
