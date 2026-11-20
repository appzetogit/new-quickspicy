import { prisma } from '../../../../config/prisma.js';
import { ValidationError, ForbiddenError, NotFoundError } from '../../../../core/auth/errors.js';
import { recordTransaction } from '../../../../core/payments/transaction.service.js';
import { isId } from '../../../../utils/helpers.js';
import { logger } from '../../../../utils/logger.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { buildOrderIdentityFilter } from './order.helpers.js';
import { istDayOf, resolveDayWindow } from '../../admin/services/reportDays.js';

/**
 * Change to wallet.
 *
 * A cash customer hands over ₹500 for a ₹380 order and the rider has no ₹120
 * change. The rider records "change owed ₹120" (with the ₹500 collected); ops
 * check it and approve, and the ₹120 is credited to the customer's wallet.
 *
 * Accounting
 *  - The rider physically holds the whole ₹500, so on approval the ₹120 is
 *    added to the rider's cash in hand (cash they owe the company) on top of
 *    the ₹380 the order already counts. Everywhere cash in hand is worked out
 *    (rider wallet, admin rider list, balance sheet / payout statements) adds
 *    approvedChangeByRider(). Deposits then clear it like any other cash.
 *  - The customer's ₹120 is a user-wallet credit through recordTransaction
 *    (category adjustment, idempotency key change_credit:<id>), shown in their
 *    wallet history as "Change from order #...".
 *  - The company is square: it received ₹500 (via the rider's deposit) and
 *    owes ₹380 of food + ₹120 of wallet balance.
 *  - Pending or rejected requests change nothing. A rejected request means the
 *    change was handed back (or never owed), so the rider holds only ₹380.
 */

/** No single order's change should be more than this. */
export const MAX_CHANGE_RUPEES = 500;
/** How long after delivery the rider can still record it. */
export const RECORD_WINDOW_HOURS = 6;

const toPaise = (v) => Math.round((Number(v) || 0) * 100);
const rupees = (p) => Math.round(p) / 100;

const ORDER_SELECT = {
    id: true, order_id: true, userId: true, dispatchDeliveryPartnerId: true, orderStatus: true,
    paymentMethod: true, paymentStatus: true, total: true, walletAmount: true, onlineAmount: true,
    deliveredAt: true, customerName: true, customerPhone: true,
};

/** The cash part of an order: total less wallet and online parts. */
const cashDuePaise = (o) => Math.max(0, toPaise(o.total) - toPaise(o.walletAmount) - toPaise(o.onlineAmount));

const view = (r, extra = {}) => ({
    id: r.id,
    orderId: r.orderId,
    deliveryPartnerId: r.deliveryPartnerId,
    userId: r.userId,
    amount: Number(r.amount),
    cashCollected: Number(r.cashCollected),
    orderCashDue: Number(r.orderCashDue),
    riderNote: r.riderNote || '',
    status: r.status,
    rejectReason: r.rejectReason || null,
    reviewedAt: r.reviewedAt,
    walletTxnId: r.walletTxnId || null,
    createdAt: r.createdAt,
    ...extra,
});

async function pushToUser(userId, title, body, data = {}) {
    try {
        const { notifyOwnersSafely } = await import('../../../../core/notifications/firebase.service.js');
        await notifyOwnersSafely([{ ownerType: 'USER', ownerId: String(userId) }], {
            title, body, data: { type: 'wallet_update', ...data, link: '/food/user/wallet' },
        });
    } catch (err) {
        logger.warn(`Change credit push failed: ${err?.message || err}`);
    }
}

/**
 * Rider: record the change they could not give.
 * Body: { amount, cashCollected, note? }. Re-sending while pending corrects it.
 */
export async function recordChangeOwed(orderId, deliveryPartnerId, { amount, cashCollected, note = '' } = {}) {
    const identity = buildOrderIdentityFilter(orderId);
    if (!identity) throw new ValidationError('Order id required');
    const order = await prisma.foodOrder.findFirst({ where: identity, select: ORDER_SELECT });
    if (!order) throw new NotFoundError('Order not found');
    if (String(order.dispatchDeliveryPartnerId || '') !== String(deliveryPartnerId)) throw new ForbiddenError('Not your order');
    if (order.paymentMethod !== 'cash') throw new ValidationError('Change can only be recorded on a cash order');
    if (!['picked_up', 'reached_drop', 'delivered'].includes(order.orderStatus)) {
        throw new ValidationError('Record change at the customer\'s door, after pickup');
    }
    if (order.orderStatus === 'delivered' && order.deliveredAt
        && Date.now() - new Date(order.deliveredAt).getTime() > RECORD_WINDOW_HOURS * 3600 * 1000) {
        throw new ValidationError(`Change can be recorded up to ${RECORD_WINDOW_HOURS} hours after delivery`);
    }

    const owedP = toPaise(amount);
    const collectedP = toPaise(cashCollected);
    const dueP = cashDuePaise(order);
    if (!(owedP > 0)) throw new ValidationError('Change owed must be more than ₹0');
    if (owedP > MAX_CHANGE_RUPEES * 100) throw new ValidationError(`Change owed cannot be more than ₹${MAX_CHANGE_RUPEES}`);
    if (!(collectedP > 0)) throw new ValidationError('Enter the cash the customer handed over');
    if (owedP > collectedP) throw new ValidationError('Change owed cannot be more than the cash collected');
    if (collectedP - owedP < dueP) {
        throw new ValidationError(
            `Cash collected ₹${rupees(collectedP)} less change ₹${rupees(owedP)} is below the ₹${rupees(dueP)} to collect`,
        );
    }

    const data = {
        deliveryPartnerId: String(deliveryPartnerId),
        userId: order.userId,
        amount: rupees(owedP),
        cashCollected: rupees(collectedP),
        orderCashDue: rupees(dueP),
        riderNote: String(note ?? '').trim().slice(0, 200),
    };

    const existing = await prisma.foodChangeCredit.findUnique({ where: { orderId: order.id } });
    let row;
    if (existing) {
        if (existing.status !== 'pending') throw new ValidationError(`Change for this order was already ${existing.status}`);
        const { count } = await prisma.foodChangeCredit.updateMany({ where: { id: existing.id, status: 'pending' }, data });
        if (!count) throw new ValidationError('Change for this order was just reviewed');
        row = await prisma.foodChangeCredit.findUnique({ where: { id: existing.id } });
    } else {
        try {
            row = await prisma.foodChangeCredit.create({ data: { orderId: order.id, ...data } });
        } catch (err) {
            if (err?.code === 'P2002') throw new ValidationError('Change for this order was just recorded');
            throw err;
        }
    }

    if (!existing) {
        void pushToUser(order.userId, 'Change added for review',
            `₹${data.amount} change from order #${order.order_id || order.id} will be added to your wallet once verified.`,
            { orderId: order.id, changeCreditId: row.id });
    }
    try { getIO()?.to(rooms.adminOrdersAll()).emit('change_credit_requested', { id: row.id, orderId: order.id, amount: data.amount }); } catch { /* optional */ }

    return view(row, { orderDisplayId: order.order_id || order.id });
}

/** Rider: the change request on one of their orders, if any. */
export async function getChangeOwedForRider(orderId, deliveryPartnerId) {
    const identity = buildOrderIdentityFilter(orderId);
    if (!identity) throw new ValidationError('Order id required');
    const order = await prisma.foodOrder.findFirst({ where: identity, select: { id: true, order_id: true, dispatchDeliveryPartnerId: true } });
    if (!order) throw new NotFoundError('Order not found');
    if (String(order.dispatchDeliveryPartnerId || '') !== String(deliveryPartnerId)) throw new ForbiddenError('Not your order');
    const row = await prisma.foodChangeCredit.findUnique({ where: { orderId: order.id } });
    return row ? view(row, { orderDisplayId: order.order_id || order.id }) : null;
}

async function claimPending(id, status, adminId, extra = {}, client = prisma) {
    if (!isId(id)) throw new ValidationError('Request id required');
    const { count } = await client.foodChangeCredit.updateMany({
        where: { id: String(id), status: 'pending' },
        data: { status, reviewedById: isId(adminId) ? String(adminId) : null, reviewedAt: new Date(), ...extra },
    });
    if (!count) {
        const row = await client.foodChangeCredit.findUnique({ where: { id: String(id) } });
        if (!row) throw new NotFoundError('Change request not found');
        throw new ValidationError(`This request was already ${row.status}`);
    }
}

/** Admin: verified -- credit the customer's wallet. */
export async function approveChangeCredit(id, adminId) {
    const pending = isId(id) ? await prisma.foodChangeCredit.findUnique({ where: { id: String(id) } }) : null;
    if (!pending) throw new NotFoundError('Change request not found');
    const order = await prisma.foodOrder.findUnique({ where: { id: pending.orderId }, select: { id: true, order_id: true, orderStatus: true } });
    if (!order) throw new NotFoundError('Order not found');
    if (order.orderStatus !== 'delivered') throw new ValidationError('Approve change only on a delivered order');

    const display = order.order_id || order.id;
    const amount = Number(pending.amount);
    const txn = await prisma.$transaction(async (tx) => {
        await claimPending(id, 'approved', adminId, {}, tx);
        const { transaction } = await recordTransaction({
            entityType: 'user',
            entityId: pending.userId,
            type: 'credit',
            amount,
            description: `Change from order #${display} (rider had no change)`,
            category: 'adjustment',
            orderId: order.id,
            metadata: {
                kind: 'cod_change_credit',
                changeCreditId: pending.id,
                deliveryPartnerId: pending.deliveryPartnerId,
                cashCollected: Number(pending.cashCollected),
                orderCashDue: Number(pending.orderCashDue),
                approvedBy: adminId ? String(adminId) : null,
            },
            idempotencyKey: `change_credit:${pending.id}`,
        }, { client: tx });
        await tx.foodChangeCredit.update({ where: { id: pending.id }, data: { walletTxnId: transaction.id } });
        return transaction;
    });

    void pushToUser(pending.userId, 'Change added to your wallet',
        `₹${amount} change from order #${display} has been added to your Quick Spicy wallet.`,
        { orderId: order.id, changeCreditId: pending.id });

    const row = await prisma.foodChangeCredit.findUnique({ where: { id: pending.id } });
    return view(row, { orderDisplayId: display, walletTxnId: txn.id });
}

/** Admin: not verified. The reason is kept and shown to the rider. */
export async function rejectChangeCredit(id, adminId, reason) {
    const why = String(reason ?? '').trim().slice(0, 300);
    if (!why) throw new ValidationError('Give a reason for rejecting');
    await claimPending(id, 'rejected', adminId, { rejectReason: why });
    const row = await prisma.foodChangeCredit.findUnique({ where: { id: String(id) } });
    return view(row);
}

/** Admin list, joined with order / rider / customer. Filters: status, fromDate/toDate (IST, created). */
export async function listChangeCredits(query = {}) {
    const status = ['pending', 'approved', 'rejected'].includes(query.status) ? query.status : undefined;
    const window = resolveDayWindow(query, { defaultDays: 0 });
    const take = Math.min(200, Math.max(1, Number(query.limit) || 50));
    const page = Math.max(1, Number(query.page) || 1);
    const where = {
        ...(status ? { status } : {}),
        ...(window ? { createdAt: { gte: window.gte, lte: window.lte } } : {}),
        ...(isId(query.deliveryPartnerId) ? { deliveryPartnerId: String(query.deliveryPartnerId) } : {}),
    };
    const [rows, total] = await Promise.all([
        prisma.foodChangeCredit.findMany({ where, orderBy: { createdAt: status === 'pending' ? 'asc' : 'desc' }, skip: (page - 1) * take, take }),
        prisma.foodChangeCredit.count({ where }),
    ]);
    const orderIds = rows.map((r) => r.orderId);
    const riderIds = [...new Set(rows.map((r) => r.deliveryPartnerId))];
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const [orders, riders, users] = await Promise.all([
        orderIds.length ? prisma.foodOrder.findMany({ where: { id: { in: orderIds } }, select: ORDER_SELECT }) : [],
        riderIds.length ? prisma.foodDeliveryPartner.findMany({ where: { id: { in: riderIds } }, select: { id: true, name: true, phone: true } }) : [],
        userIds.length ? prisma.foodUser.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, phone: true } }) : [],
    ]);
    const oById = new Map(orders.map((o) => [o.id, o]));
    const rById = new Map(riders.map((r) => [r.id, r]));
    const uById = new Map(users.map((u) => [u.id, u]));
    return {
        items: rows.map((r) => {
            const o = oById.get(r.orderId) || {};
            const rider = rById.get(r.deliveryPartnerId);
            const user = uById.get(r.userId);
            return view(r, {
                orderDisplayId: o.order_id || r.orderId,
                orderTotal: Number(o.total ?? 0),
                orderStatus: o.orderStatus || null,
                deliveredAt: o.deliveredAt || null,
                rider: rider ? { id: rider.id, name: rider.name, phone: rider.phone } : null,
                customer: { id: r.userId, name: o.customerName || user?.name || '', phone: o.customerPhone || user?.phone || '' },
                // What the customer overpaid; should equal amount unless part was handed back.
                overpaid: rupees(toPaise(r.cashCollected) - toPaise(r.orderCashDue)),
            });
        }),
        pagination: { page, limit: take, total, pages: Math.max(1, Math.ceil(total / take)) },
    };
}

/**
 * The day's summary (IST day, default today): requested that day by status,
 * approved that day, and everything still pending (with the oldest).
 */
export async function changeCreditDailySummary({ date } = {}) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? String(date) : istDayOf();
    const window = resolveDayWindow({ fromDate: day, toDate: day });
    const inDay = { gte: window.gte, lte: window.lte };
    const [createdByStatus, approvedToday, rejectedToday, pendingAll, oldestPending, byRider] = await Promise.all([
        prisma.foodChangeCredit.groupBy({ by: ['status'], where: { createdAt: inDay }, _count: { _all: true }, _sum: { amount: true } }),
        prisma.foodChangeCredit.aggregate({ where: { status: 'approved', reviewedAt: inDay }, _count: { _all: true }, _sum: { amount: true } }),
        prisma.foodChangeCredit.aggregate({ where: { status: 'rejected', reviewedAt: inDay }, _count: { _all: true }, _sum: { amount: true } }),
        prisma.foodChangeCredit.aggregate({ where: { status: 'pending' }, _count: { _all: true }, _sum: { amount: true } }),
        prisma.foodChangeCredit.findFirst({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
        prisma.foodChangeCredit.groupBy({ by: ['deliveryPartnerId'], where: { status: 'approved', reviewedAt: inDay }, _count: { _all: true }, _sum: { amount: true } }),
    ]);
    const riders = byRider.length
        ? await prisma.foodDeliveryPartner.findMany({ where: { id: { in: byRider.map((r) => r.deliveryPartnerId) } }, select: { id: true, name: true } })
        : [];
    const name = new Map(riders.map((r) => [r.id, r.name]));
    const agg = (a) => ({ count: a?._count?._all || 0, amount: Number(a?._sum?.amount ?? 0) });
    return {
        date: day,
        requested: Object.fromEntries(['pending', 'approved', 'rejected'].map((s) => [s, agg(createdByStatus.find((c) => c.status === s))])),
        approvedToday: agg(approvedToday),
        rejectedToday: agg(rejectedToday),
        pendingTotal: { ...agg(pendingAll), oldestAt: oldestPending?.createdAt || null },
        // Added to each rider's cash in hand by today's approvals.
        approvedByRider: byRider.map((r) => ({ deliveryPartnerId: r.deliveryPartnerId, name: name.get(r.deliveryPartnerId) || '', ...agg(r) })),
    };
}

/**
 * Approved change each rider kept (and so owes as cash), by rider id.
 * `reviewedIn` limits to approvals in a { gte, lte } window; `orderIds` to those
 * orders (the balance sheet passes its unsettled cash orders, so a settled
 * period is not counted twice).
 * Never throws: before the migration has run it returns an empty map.
 */
export async function approvedChangeByRider(partnerIds = null, { reviewedIn = null, orderIds = null } = {}) {
    try {
        const ids = Array.isArray(partnerIds) ? partnerIds.filter(Boolean).map(String) : null;
        if (ids && !ids.length) return new Map();
        if (Array.isArray(orderIds) && !orderIds.length) return new Map();
        const rows = await prisma.foodChangeCredit.groupBy({
            by: ['deliveryPartnerId'],
            where: {
                status: 'approved',
                ...(ids ? { deliveryPartnerId: { in: ids } } : {}),
                ...(reviewedIn ? { reviewedAt: { gte: reviewedIn.gte, lte: reviewedIn.lte } } : {}),
                ...(Array.isArray(orderIds) ? { orderId: { in: orderIds.map(String) } } : {}),
            },
            _sum: { amount: true },
        });
        return new Map(rows.map((r) => [r.deliveryPartnerId, Number(r._sum.amount ?? 0)]));
    } catch (err) {
        logger.warn(`approvedChangeByRider failed: ${err?.message || err}`);
        return new Map();
    }
}
