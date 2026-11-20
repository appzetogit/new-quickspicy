import { prisma } from '../../../../config/prisma.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { logger } from '../../../../utils/logger.js';
import { runUnscoped } from '../../../../core/roles/adminScope.context.js';
import { ValidationError, ForbiddenError, NotFoundError } from '../../../../core/auth/errors.js';
import { buildOrderIdentityFilter, pushStatusHistory } from './order.helpers.js';
import { notifyCustomer } from './customerNotify.service.js';
import { DELAY_REASONS, buildDelayView } from './orderDelay.view.js';

/**
 * "Running late": telling the customer before they have to ask.
 *
 * 1. The rider (or an admin) sends an update with a reason and extra minutes.
 *    The order's ETA moves out by that much, the customer gets a push and a
 *    live `order_delay` / `order_status_update` / `order_eta`, and the live
 *    ETA is never pulled back earlier than what was announced (eta.service.js
 *    clamps to delayedUntil).
 * 2. The order watchdog (scripts/run-scheduled-jobs.js) finds orders more than
 *    LATE_GRACE_MINUTES past what they were promised and sends a one-time
 *    apology. "Promised" is the first ETA the customer saw
 *    (promisedDeliveryAt), or the time last announced in a running-late
 *    update when there was one -- a customer told "20 more minutes" is not
 *    late until those run out.
 */

export const LIVE_STATUSES = ['created', 'confirmed', 'preparing', 'ready_for_pickup', 'reached_pickup', 'picked_up', 'reached_drop'];
export const MAX_EXTRA_MINUTES = 120;
export const LATE_GRACE_MINUTES = 10;
/** One update every this many seconds per order, so a double tap is not two pushes. */
export const REPORT_COOLDOWN_SECONDS = 60;

const DELAY_SELECT = {
    id: true, order_id: true, userId: true, orderStatus: true, scheduledAt: true,
    dispatchDeliveryPartnerId: true, estimatedDeliveryAt: true, etaMinutes: true,
    promisedDeliveryAt: true, delayReason: true, delayNote: true, delayExtraMinutes: true,
    delayedUntil: true, delayReportedAt: true, delayReportedBy: true, delayAutoNoticeAt: true,
};

const clockText = (d) => new Date(d).toLocaleTimeString('en-IN', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
});

/** Live updates to the customer's screens; the next fetch carries it anyway. */
function emitDelay(row, message) {
    try {
        const io = getIO();
        if (!io) return;
        const delay = buildDelayView(row);
        const payload = {
            orderId: row.id,
            orderMongoId: row.id,
            orderDisplayId: row.order_id || row.id,
            orderStatus: row.orderStatus,
            etaMinutes: row.etaMinutes,
            estimatedDeliveryAt: row.estimatedDeliveryAt ? new Date(row.estimatedDeliveryAt).toISOString() : null,
            delay,
        };
        for (const room of [rooms.user(row.userId), rooms.tracking(row.id)]) {
            io.to(room).emit('order_delay', { ...payload, message });
            io.to(room).emit('order_eta', payload);
        }
        // The web tracking page refreshes the order on this event and shows `message`.
        io.to(rooms.user(row.userId)).emit('order_status_update', {
            ...payload, title: 'Running late', message, delay,
        });
        if (row.dispatchDeliveryPartnerId) {
            io.to(rooms.delivery(row.dispatchDeliveryPartnerId)).emit('order_delay', payload);
        }
    } catch (err) {
        logger.warn(`Delay emit failed for ${row.id}: ${err?.message || err}`);
    }
}

/**
 * Report an order as running late.
 *
 * @param {object} p
 * @param {string} p.orderId id or display id
 * @param {string} p.reason traffic | rain | restaurant_delay | other
 * @param {number} p.extraMinutes 1..120
 * @param {string} [p.note] free text, required when reason is "other"
 * @param {{ role: 'DELIVERY_PARTNER'|'ADMIN', id: string }} p.by
 */
export async function reportRunningLate({ orderId, reason, extraMinutes, note = '', by = {} } = {}) {
    const identity = buildOrderIdentityFilter(orderId);
    if (!identity) throw new ValidationError('Order id required');

    const why = String(reason || '').trim().toLowerCase();
    if (!DELAY_REASONS[why]) {
        throw new ValidationError(`reason must be one of: ${Object.keys(DELAY_REASONS).join(', ')}`);
    }
    const minutes = Number(extraMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_EXTRA_MINUTES) {
        throw new ValidationError(`extraMinutes must be a whole number from 1 to ${MAX_EXTRA_MINUTES}`);
    }
    const text = String(note ?? '').trim().slice(0, 200);
    if (why === 'other' && !text) throw new ValidationError('Say what the delay is when the reason is "other"');

    const role = by.role === 'ADMIN' ? 'ADMIN' : 'DELIVERY_PARTNER';
    // An admin stays inside their city scope; a rider is checked by ownership below.
    const find = () => prisma.foodOrder.findFirst({ where: identity, select: DELAY_SELECT });
    const row = role === 'ADMIN' ? await find() : await runUnscoped(find);
    if (!row) throw new NotFoundError('Order not found');
    if (role === 'DELIVERY_PARTNER' && String(row.dispatchDeliveryPartnerId || '') !== String(by.id || '')) {
        throw new ForbiddenError('Not your order');
    }
    if (!LIVE_STATUSES.includes(row.orderStatus)) {
        throw new ValidationError('Only an order on its way can be marked as running late');
    }
    if (row.delayReportedAt && Date.now() - new Date(row.delayReportedAt).getTime() < REPORT_COOLDOWN_SECONDS * 1000) {
        throw new ValidationError('A delay update was just sent for this order. Try again in a minute.');
    }

    const now = new Date();
    // Later of "now" and what the customer was last told, plus the extra minutes.
    const told = [row.delayedUntil, row.estimatedDeliveryAt, row.promisedDeliveryAt]
        .filter(Boolean).map((d) => new Date(d).getTime());
    const base = Math.max(now.getTime(), ...told);
    const delayedUntil = new Date(base + minutes * 60000);
    const etaMinutes = Math.max(1, Math.ceil((delayedUntil.getTime() - now.getTime()) / 60000));

    // Conditional on the report it read, so two updates at once cannot both pass the cooldown.
    const { count } = await prisma.foodOrder.updateMany({
        where: { id: row.id, delayReportedAt: row.delayReportedAt ?? null },
        data: {
            delayReason: why,
            delayNote: text || null,
            delayExtraMinutes: { increment: minutes },
            delayedUntil,
            delayReportedAt: now,
            delayReportedBy: role,
            estimatedDeliveryAt: delayedUntil,
            etaMinutes,
            etaComputedAt: now,
            ...(row.promisedDeliveryAt ? {} : { promisedDeliveryAt: row.estimatedDeliveryAt || now }),
        },
    });
    if (count === 0) throw new ValidationError('A delay update was just sent for this order. Try again in a minute.');

    const updated = await prisma.foodOrder.findUnique({ where: { id: row.id }, select: DELAY_SELECT });
    const reasonText = DELAY_REASONS[why].text || text;
    const etaText = clockText(delayedUntil);
    const message = `Running ${minutes} min late${reasonText ? ` due to ${reasonText}` : ''}. New arrival time ${etaText}.`;

    await pushStatusHistory(row.id, {
        byRole: role,
        byId: by.id || null,
        from: row.orderStatus,
        to: row.orderStatus,
        note: `Running late +${minutes} min (${why})${text ? `: ${text}` : ''}`,
    }).catch(() => {});

    void notifyCustomer(row.id, 'running_late', {
        key: `running_late:${now.getTime()}`,
        ctx: { extraMinutes: minutes, reasonText, etaText },
    });
    emitDelay(updated, message);

    logger.info(`Order ${row.order_id || row.id} running late +${minutes}m (${why}) by ${role}`);
    return { orderId: row.id, orderDisplayId: row.order_id || row.id, etaMinutes, estimatedDeliveryAt: delayedUntil.toISOString(), delay: buildDelayView(updated), message };
}

/**
 * The watchdog half: a one-time apology for each order more than
 * LATE_GRACE_MINUTES past its promise. Never throws; returns how many were sent.
 * Scheduled orders are left alone (their ETA is not measured from placement).
 */
export async function flagDelayedOrders({ now = new Date(), graceMinutes = LATE_GRACE_MINUTES, limit = 50, orderIds = null } = {}) {
    let sent = 0;
    try {
        const cutoff = new Date(now.getTime() - graceMinutes * 60000);
        const late = await runUnscoped(() => prisma.foodOrder.findMany({
            where: {
                orderStatus: { in: LIVE_STATUSES },
                delayAutoNoticeAt: null,
                scheduledAt: null,
                ...(Array.isArray(orderIds) ? { id: { in: orderIds.map(String) } } : {}),
                OR: [
                    { delayedUntil: null, promisedDeliveryAt: { lt: cutoff } },
                    { delayedUntil: { lt: cutoff } },
                ],
            },
            select: DELAY_SELECT,
            orderBy: { promisedDeliveryAt: 'asc' },
            take: limit,
        }));

        for (const row of late) {
            // Claim first: two watchdogs at once send one apology.
            const { count } = await prisma.foodOrder.updateMany({
                where: { id: row.id, delayAutoNoticeAt: null },
                data: { delayAutoNoticeAt: now },
            });
            if (!count) continue;
            const eta = row.estimatedDeliveryAt && new Date(row.estimatedDeliveryAt) > now ? row.estimatedDeliveryAt : null;
            const etaText = eta ? clockText(eta) : '';
            await notifyCustomer(row.id, 'delayed', { ctx: { etaText } });
            emitDelay({ ...row, delayAutoNoticeAt: now },
                `Sorry, your order is running late.${etaText ? ` We now expect it by ${etaText}.` : ''}`);
            sent += 1;
        }
        if (sent) logger.warn(`Delay watchdog: apologised for ${sent} late order(s)`);
    } catch (err) {
        logger.error(`Delay watchdog failed: ${err?.message || err}`);
    }
    return sent;
}
