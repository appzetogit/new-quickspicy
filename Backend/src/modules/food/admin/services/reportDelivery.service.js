import { prisma } from '../../../../config/prisma.js';
import { isId } from '../../../../utils/helpers.js';
import { dayRange } from '../../../../utils/timezone.js';

/**
 * Delivery performance report and the dashboard's "Live delivery agents" tile.
 *
 * Timings come from the order's own columns (dispatchAcceptedAt, pickedUpAt,
 * deliveredAt) and from the status history, which is the only place the
 * restaurant accepting (confirmed / preparing) and marking ready
 * (ready_for_pickup) is timestamped.
 *
 * Late: FoodOrder.estimatedDeliveryAt is a rolling ETA that is recomputed on
 * every status change and rider ping, so by delivery it has caught up with the
 * rider and says nothing about what was promised. An order is late instead
 * when placed -> delivered took longer than the delivery time the restaurant
 * advertises to customers (the upper figure of estimatedDeliveryTime, e.g.
 * "25-30 mins" -> 30, else estimatedDeliveryTimeMinutes), or
 * DEFAULT_LATE_AFTER_MINUTES when the restaurant shows none. `lateAfterMinutes`
 * in the query replaces this with one fixed threshold for every order.
 * Scheduled orders are left out of placed -> delivered and of lateness: they
 * were never meant to arrive straight away.
 *
 * Utilisation: busy time / online time. Online time is the rider's shifts
 * (FoodDeliveryPartnerSession) clipped to the range, an open shift running to
 * now. Busy time is the union of [rider accepted, delivered] over their
 * delivered orders, clipped the same way, so two orders carried together are
 * not counted twice.
 */

export const DEFAULT_LATE_AFTER_MINUTES = 45;
/** A rider counts as live on the dashboard when their GPS reached us this recently. */
export const LIVE_LOCATION_MINUTES = 15;
/** Ceiling on orders read for one report, so a huge range cannot exhaust memory. */
const MAX_ORDERS = 20000;
const DEFAULT_RANGE_DAYS = 30;

const MIN = 60000;
const minutesBetween = (a, b) => (a && b ? (new Date(b).getTime() - new Date(a).getTime()) / MIN : null);
const round1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
const avg = (list) => {
    const xs = list.filter((v) => v != null && Number.isFinite(v));
    return xs.length ? round1(xs.reduce((s, v) => s + v, 0) / xs.length) : null;
};

/** "25-30 mins" -> 30, "1 hr" -> 60, else the stored minutes, else null. */
export const promisedMinutes = (restaurant) => {
    const text = String(restaurant?.estimatedDeliveryTime ?? '').toLowerCase();
    const numbers = (text.match(/\d+(\.\d+)?/g) || []).map(Number).filter((n) => n > 0);
    if (numbers.length) {
        const m = Math.max(...numbers) * (/\bh(ou)?rs?\b|\bhr\b/.test(text) ? 60 : 1);
        if (m > 0 && m <= 240) return Math.round(m);
    }
    const stored = Number(restaurant?.estimatedDeliveryTimeMinutes);
    return Number.isFinite(stored) && stored > 0 ? stored : null;
};

/** Total length of the union of [start, end] intervals (ms), each clipped to [lo, hi]. */
export const unionMs = (intervals, lo, hi) => {
    const clipped = intervals
        .map(([s, e]) => [Math.max(s, lo), Math.min(e, hi)])
        .filter(([s, e]) => e > s)
        .sort((a, b) => a[0] - b[0]);
    let total = 0;
    let cur = null;
    for (const [s, e] of clipped) {
        if (!cur || s > cur[1]) {
            if (cur) total += cur[1] - cur[0];
            cur = [s, e];
        } else if (e > cur[1]) cur[1] = e;
    }
    if (cur) total += cur[1] - cur[0];
    return total;
};

const istDay = (d) => new Date(new Date(d).getTime() + 330 * MIN).toISOString().slice(0, 10);

/** The report window: from/to as IST days, else the last 30 days. */
const resolveRange = (q, now) => {
    const r = dayRange(q) || {};
    const end = r.lte && r.lte < now ? r.lte : now;
    const start = r.gte || new Date(end.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * MIN);
    return { start, end, explicit: Boolean(r.gte || r.lte) };
};

/** Per-order timings, all in minutes; null where a timestamp is missing. */
export const orderTimings = (o, { lateAfterMinutes = null } = {}) => {
    const hist = o.statusHistory || [];
    const firstAt = (states) => hist
        .filter((h) => states.includes(h.to))
        .map((h) => new Date(h.at).getTime())
        .sort((a, b) => a - b)[0];
    const acceptedAt = firstAt(['confirmed', 'preparing', 'ready_for_pickup']);
    const readyAt = firstAt(['ready_for_pickup']);
    const pickedUp = o.pickedUpAt ? new Date(o.pickedUpAt).getTime() : null;

    const acceptToPickup = acceptedAt && pickedUp ? Math.max(0, (pickedUp - acceptedAt) / MIN) : null;
    // A restaurant that marks ready after the rider has already left did not
    // make the rider wait: count that as 0 rather than a negative.
    const readyToPickup = readyAt && pickedUp ? Math.max(0, (pickedUp - readyAt) / MIN) : null;
    const transit = minutesBetween(o.pickedUpAt, o.deliveredAt);
    const scheduled = Boolean(o.scheduledAt);
    const total = scheduled ? null : minutesBetween(o.createdAt, o.deliveredAt);
    const promised = lateAfterMinutes ?? promisedMinutes(o.restaurant) ?? DEFAULT_LATE_AFTER_MINUTES;
    const late = total == null ? null : total > promised;
    return { acceptToPickup, readyToPickup, transit, total, promised, late, scheduled };
};

const summarise = (timings) => {
    const judged = timings.filter((t) => t.late != null);
    const late = judged.filter((t) => t.late).length;
    return {
        deliveries: timings.length,
        avgAcceptToPickupMinutes: avg(timings.map((t) => t.acceptToPickup)),
        avgReadyToPickupMinutes: avg(timings.map((t) => t.readyToPickup)),
        avgTransitMinutes: avg(timings.map((t) => t.transit)),
        avgTotalMinutes: avg(timings.map((t) => t.total)),
        lateDeliveries: late,
        latePercent: judged.length ? round1((late / judged.length) * 100) : null,
        scheduledExcluded: timings.filter((t) => t.scheduled).length,
    };
};

/**
 * GET /admin/reports/delivery-performance
 * Query: from, to (IST days; default last 30 days), zoneId, deliveryPartnerId,
 * lateAfterMinutes (optional fixed threshold).
 */
export async function deliveryPerformanceReport(q = {}) {
    const now = new Date();
    const { start, end, explicit } = resolveRange(q, now);
    const zoneId = isId(q.zoneId) ? String(q.zoneId) : null;
    const riderId = isId(q.deliveryPartnerId || q.riderId) ? String(q.deliveryPartnerId || q.riderId) : null;
    const fixedLate = Number(q.lateAfterMinutes);
    const lateAfterMinutes = Number.isFinite(fixedLate) && fixedLate > 0 ? Math.round(fixedLate) : null;

    const orders = await prisma.foodOrder.findMany({
        where: {
            orderStatus: 'delivered',
            deliveredAt: { gte: start, lte: end },
            // Orders given to an outside rider have no rider account to report on.
            dispatchDeliveryPartnerId: riderId ? riderId : { not: null },
            ...(zoneId ? { zoneId } : {}),
        },
        orderBy: { deliveredAt: 'desc' },
        take: MAX_ORDERS,
        select: {
            id: true, createdAt: true, scheduledAt: true, dispatchAcceptedAt: true,
            pickedUpAt: true, deliveredAt: true, dispatchDeliveryPartnerId: true,
            restaurant: { select: { estimatedDeliveryTime: true, estimatedDeliveryTimeMinutes: true } },
            statusHistory: {
                where: { to: { in: ['confirmed', 'preparing', 'ready_for_pickup'] } },
                select: { to: true, at: true },
            },
        },
    });

    const byRider = new Map();
    const allTimings = [];
    for (const o of orders) {
        const t = orderTimings(o, { lateAfterMinutes });
        allTimings.push(t);
        const row = byRider.get(o.dispatchDeliveryPartnerId) || { timings: [], busy: [] };
        row.timings.push(t);
        const from = o.dispatchAcceptedAt || o.pickedUpAt;
        if (from && o.deliveredAt) row.busy.push([new Date(from).getTime(), new Date(o.deliveredAt).getTime()]);
        byRider.set(o.dispatchDeliveryPartnerId, row);
    }

    // Riders who were online in the range but delivered nothing still belong
    // in a utilisation report. The partner lookup goes through the scoped
    // client, so a city-limited admin only gets their own riders' shifts.
    const sessionWhere = {
        wentOnlineAt: { lte: end },
        OR: [{ wentOfflineAt: null }, { wentOfflineAt: { gte: start } }],
        ...(riderId ? { deliveryPartnerId: riderId } : {}),
        ...(zoneId && !riderId ? { deliveryPartner: { zoneId } } : {}),
    };
    const sessions = await prisma.foodDeliveryPartnerSession.findMany({
        where: sessionWhere,
        select: { deliveryPartnerId: true, wentOnlineAt: true, wentOfflineAt: true },
    });
    const sessionsByRider = new Map();
    for (const s of sessions) {
        const list = sessionsByRider.get(s.deliveryPartnerId) || [];
        list.push(s);
        sessionsByRider.set(s.deliveryPartnerId, list);
    }

    const ids = [...new Set([...byRider.keys(), ...sessionsByRider.keys()])];
    const partners = ids.length
        ? await prisma.foodDeliveryPartner.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true, phone: true, zoneId: true, zone: { select: { name: true } } },
        })
        : [];
    const partnerById = new Map(partners.map((p) => [p.id, p]));

    const lo = start.getTime();
    const hi = end.getTime();
    let onlineTotal = 0;
    let busyTotal = 0;
    const riders = [];
    for (const id of ids) {
        const partner = partnerById.get(id);
        const delivered = byRider.get(id);
        // Shift-only rows for riders outside the admin's scope are dropped;
        // rows with deliveries in a visible order are kept.
        if (!partner && !delivered) continue;
        const shifts = sessionsByRider.get(id) || [];
        const onlineMs = unionMs(
            shifts.map((s) => [new Date(s.wentOnlineAt).getTime(), s.wentOfflineAt ? new Date(s.wentOfflineAt).getTime() : now.getTime()]),
            lo, hi,
        );
        const busyMs = unionMs(delivered?.busy || [], lo, hi);
        const onlineDays = new Set(shifts.map((s) => istDay(s.wentOnlineAt > start ? s.wentOnlineAt : start))).size;
        onlineTotal += onlineMs;
        busyTotal += busyMs;
        const stats = summarise(delivered?.timings || []);
        riders.push({
            deliveryPartnerId: id,
            name: partner?.name || 'Rider',
            phone: partner?.phone || '',
            zoneId: partner?.zoneId || null,
            zoneName: partner?.zone?.name || '',
            ...stats,
            onlineMinutes: Math.round(onlineMs / MIN),
            busyMinutes: Math.round(busyMs / MIN),
            onlineDays,
            // Over 100 can only happen when the app recorded no shift for time
            // spent delivering; capped so one missing shift does not mislead.
            utilisationPercent: onlineMs > 0 ? Math.min(100, round1((busyMs / onlineMs) * 100)) : null,
            deliveriesPerOnlineHour: onlineMs > 0 ? round1(stats.deliveries / (onlineMs / (60 * MIN))) : null,
            deliveriesPerOnlineDay: onlineDays > 0 ? round1(stats.deliveries / onlineDays) : null,
        });
    }
    riders.sort((a, b) => b.deliveries - a.deliveries || b.onlineMinutes - a.onlineMinutes);

    return {
        range: { from: start, to: end, defaulted: !explicit },
        overall: {
            ...summarise(allTimings),
            riders: riders.filter((r) => r.deliveries > 0).length,
            ridersOnline: riders.filter((r) => r.onlineMinutes > 0).length,
            onlineMinutes: Math.round(onlineTotal / MIN),
            busyMinutes: Math.round(busyTotal / MIN),
            utilisationPercent: onlineTotal > 0 ? Math.min(100, round1((busyTotal / onlineTotal) * 100)) : null,
        },
        riders,
        truncated: orders.length >= MAX_ORDERS,
        definitions: {
            acceptToPickup: 'Restaurant accepted (first confirmed/preparing in status history) to rider picked up.',
            readyToPickup: 'Restaurant marked ready to rider picked up (0 when marked ready after pickup).',
            transit: 'Picked up to delivered.',
            total: 'Order placed to delivered. Scheduled orders are left out.',
            late: lateAfterMinutes
                ? `Placed to delivered took longer than ${lateAfterMinutes} minutes.`
                : `Placed to delivered took longer than the delivery time the restaurant shows customers (upper figure), or ${DEFAULT_LATE_AFTER_MINUTES} minutes when it shows none.`,
            utilisation: 'Time between accepting and delivering orders (overlaps counted once) as a share of time online (rider shifts), both within the range.',
        },
    };
}

/**
 * The dashboard tile: approved riders who are online now and whose GPS has
 * reached us in the last LIVE_LOCATION_MINUTES. `online` is everyone with the
 * online flag, including those whose app has gone quiet.
 */
export async function countLiveDeliveryAgents(zoneId = null, now = new Date()) {
    const where = {
        status: 'approved',
        availabilityStatus: 'online',
        deletedAt: null,
        ...(isId(zoneId) ? { zoneId: String(zoneId) } : {}),
    };
    const freshSince = new Date(now.getTime() - LIVE_LOCATION_MINUTES * MIN);
    const [online, live] = await Promise.all([
        prisma.foodDeliveryPartner.count({ where }),
        prisma.foodDeliveryPartner.count({ where: { ...where, lastLocationAt: { gte: freshSince } } }),
    ]);
    return { live, online, freshWithinMinutes: LIVE_LOCATION_MINUTES };
}
