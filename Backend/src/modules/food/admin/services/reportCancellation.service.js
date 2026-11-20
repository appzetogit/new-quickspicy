import { prisma } from '../../../../config/prisma.js';
import { num, reportFilters } from './reportFilters.helpers.js';

/**
 * Cancellation & refund report.
 *
 * Who cancelled comes from the status-history row that moved the order into
 * a cancelled status (byRole + note), falling back to the status itself:
 *   - customer:   cancelled by the customer (cancelled_by_user)
 *   - restaurant: rejected by the restaurant, or auto-cancelled because the
 *                 restaurant did not accept / respond in time
 *   - admin:      cancelled by an admin from the panel
 *   - delivery:   auto-expired because no delivery partner could be found.
 *                 Riders themselves cannot cancel an order -- a rider can only
 *                 reject an offer, which re-dispatches it -- so there is no
 *                 rider-initiated cancellation to report.
 *   - system:     any other automatic cancellation
 *
 * The window is when the order was placed (India days). Order value lost is
 * the order total. Refunds come from food_order_refunds: failed legs are not
 * counted as refunded.
 */

export const CANCELLED_STATUSES = ['cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin'];
export const ACTORS = ['customer', 'restaurant', 'admin', 'delivery', 'system'];
const ACTOR_LABELS = {
    customer: 'Customer',
    restaurant: 'Restaurant',
    admin: 'Admin',
    delivery: 'Delivery (no rider found)',
    system: 'System (automatic)',
};

/** Who caused one cancellation. Exported for the tests. */
export function cancellationActor(orderStatus, history) {
    const role = history?.byRole || null;
    const note = String(history?.note || '');
    if (role === 'USER') return 'customer';
    if (role === 'RESTAURANT') return 'restaurant';
    if (role === 'DELIVERY_PARTNER') return 'delivery';
    if (role === 'ADMIN') return 'admin';
    if (orderStatus === 'cancelled_by_user') return 'customer';
    if (orderStatus === 'cancelled_by_restaurant') return 'restaurant';
    if (role === 'SYSTEM') {
        if (/delivery partner|rider/i.test(note)) return 'delivery';
        if (/restaurant/i.test(note)) return 'restaurant';
        return 'system';
    }
    return 'admin';
}

const reasonOf = (order, history) => {
    const fromHistory = String(history?.note || '').trim();
    if (fromHistory) return fromHistory;
    const fromRefund = (order.refundLegs || []).map((l) => String(l.reason || '').trim()).find(Boolean);
    return fromRefund || '';
};

/** Refund figures for one order from its refund legs. */
export function refundSummary(order) {
    const legs = order.refundLegs || [];
    const sum = (status) => num(legs.filter((l) => l.status === status).reduce((s, l) => s + Number(l.amount || 0), 0));
    const processed = sum('processed');
    const pending = sum('pending');
    const failed = sum('failed');
    let status = order.refundStatus || 'none';
    if (!legs.length && status === 'none') status = 'not_applicable';
    return { processed, pending, failed, refunded: num(processed + pending), status };
}

const MAX_ORDERS = 20000;

export async function getCancellationReport(query = {}) {
    const { createdAt, zoneId, restaurantId } = reportFilters(query);
    const listLimit = Math.min(Math.max(parseInt(query.limit, 10) || 500, 1), 2000);
    const actorFilter = ACTORS.includes(query.actor) ? query.actor : null;

    const base = {
        ...(createdAt ? { createdAt } : {}),
        ...(zoneId ? { zoneId } : {}),
        ...(restaurantId ? { restaurantId } : {}),
    };

    const [rows, placedOrders] = await Promise.all([
        prisma.foodOrder.findMany({
            where: { ...base, orderStatus: { in: CANCELLED_STATUSES } },
            orderBy: { createdAt: 'desc' },
            take: MAX_ORDERS,
            select: {
                id: true, order_id: true, orderStatus: true, createdAt: true, updatedAt: true,
                total: true, subtotal: true, paymentMethod: true, paymentStatus: true,
                refundStatus: true, zoneId: true, customerName: true,
                restaurant: { select: { id: true, restaurantName: true } },
                zone: { select: { id: true, name: true, zoneName: true } },
                statusHistory: {
                    where: { to: { in: CANCELLED_STATUSES } },
                    orderBy: { at: 'desc' },
                    take: 1,
                    select: { byRole: true, note: true, at: true },
                },
                refundLegs: { select: { amount: true, status: true, reason: true, initiatedBy: true, chargedTo: true } },
            },
        }),
        // Every real order placed in the window, for the cancellation rate.
        prisma.foodOrder.count({ where: { ...base, orderStatus: { not: 'pending_payment' } } }),
    ]);

    const byActor = Object.fromEntries(ACTORS.map((a) => [a, {
        actor: a, label: ACTOR_LABELS[a], count: 0, valueLost: 0, refunded: 0, refundPending: 0, refundFailed: 0,
    }]));
    const reasons = new Map();
    const totals = { count: 0, valueLost: 0, refunded: 0, refundProcessed: 0, refundPending: 0, refundFailed: 0, chargedToRestaurant: 0 };
    const list = [];

    for (const order of rows) {
        const history = order.statusHistory?.[0] || null;
        const actor = cancellationActor(order.orderStatus, history);
        const reason = reasonOf(order, history);
        const refund = refundSummary(order);
        const total = num(order.total);

        const bucket = byActor[actor];
        bucket.count += 1;
        bucket.valueLost += total;
        bucket.refunded += refund.refunded;
        bucket.refundPending += refund.pending;
        bucket.refundFailed += refund.failed;

        totals.count += 1;
        totals.valueLost += total;
        totals.refunded += refund.refunded;
        totals.refundProcessed += refund.processed;
        totals.refundPending += refund.pending;
        totals.refundFailed += refund.failed;
        totals.chargedToRestaurant += (order.refundLegs || [])
            .filter((l) => l.chargedTo === 'restaurant' && l.status !== 'failed')
            .reduce((s, l) => s + Number(l.amount || 0), 0);

        const tidy = reason.replace(/\s+/g, ' ').trim();
        const key = tidy.toLowerCase() || '__none__';
        // The label is the same whichever spelling of the reason is read first.
        const label = tidy ? tidy.charAt(0).toUpperCase() + tidy.slice(1).toLowerCase() : 'No reason given';
        const r = reasons.get(key) || { reason: label, count: 0, valueLost: 0, actors: {} };
        r.count += 1;
        r.valueLost += total;
        r.actors[actor] = (r.actors[actor] || 0) + 1;
        reasons.set(key, r);

        if ((!actorFilter || actorFilter === actor) && list.length < listLimit) {
            list.push({
                id: order.id,
                orderId: order.order_id || order.id,
                placedAt: order.createdAt,
                cancelledAt: history?.at || order.updatedAt,
                restaurantName: order.restaurant?.restaurantName || 'Unknown restaurant',
                zoneName: order.zone ? (order.zone.zoneName || order.zone.name) : '',
                customerName: order.customerName || '',
                orderStatus: order.orderStatus,
                actor,
                actorLabel: ACTOR_LABELS[actor],
                automatic: history?.byRole === 'SYSTEM',
                reason: reason || 'No reason given',
                orderTotal: total,
                paymentMethod: order.paymentMethod,
                paymentStatus: order.paymentStatus,
                refundStatus: refund.status,
                refunded: refund.refunded,
                refundProcessed: refund.processed,
                refundPending: refund.pending,
                refundFailed: refund.failed,
            });
        }
    }

    const actorRows = ACTORS.map((a) => {
        const b = byActor[a];
        return {
            ...b,
            valueLost: num(b.valueLost),
            refunded: num(b.refunded),
            refundPending: num(b.refundPending),
            refundFailed: num(b.refundFailed),
            share: totals.count ? Math.round((b.count / totals.count) * 1000) / 10 : 0,
        };
    });

    const listTotal = actorFilter ? byActor[actorFilter].count : totals.count;

    return {
        summary: {
            cancelledOrders: totals.count,
            placedOrders,
            cancellationRate: placedOrders ? Math.round((totals.count / placedOrders) * 1000) / 10 : 0,
            valueLost: num(totals.valueLost),
            refunded: num(totals.refunded),
            refundProcessed: num(totals.refundProcessed),
            refundPending: num(totals.refundPending),
            refundFailed: num(totals.refundFailed),
            chargedToRestaurant: num(totals.chargedToRestaurant),
        },
        byActor: actorRows,
        topReasons: [...reasons.values()]
            .sort((a, b) => b.count - a.count || b.valueLost - a.valueLost)
            .slice(0, 10)
            .map((r) => ({ ...r, valueLost: num(r.valueLost) })),
        orders: list,
        pagination: { total: listTotal, returned: list.length, truncated: rows.length >= MAX_ORDERS },
        notes: [
            'Riders cannot cancel orders; a rider rejecting an offer re-dispatches it. "Delivery" counts orders that expired because no rider was found.',
            'Window is the time the order was placed (India time). Value lost is the order total.',
        ],
    };
}
