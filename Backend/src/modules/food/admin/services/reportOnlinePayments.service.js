import { prisma } from '../../../../config/prisma.js';
import { currentAdminScope } from '../../../../core/roles/adminScope.context.js';
import { createdAtIn, fromPaise, num, pageOf, resolveDayWindow, resolveZoneFilter, toPaise } from './reportDays.js';

/**
 * Online payments received: money that came in through Razorpay.
 *
 *  - Orders paid online: payment method razorpay (checkout) or razorpay_qr
 *    (the rider's QR at the door), whose payment went through (order payment
 *    status paid, authorized or refunded -- a refunded order was still paid).
 *    The amount is the online part: onlineAmount when recorded (a split
 *    wallet + online order), else total less any wallet part.
 *  - Wallet top-ups: user wallet credits in category wallet_topup that are
 *    not cashback or a top-up bonus (those are wallet_topup too) and not the
 *    dev fallback. Top-ups belong to no zone, so they are left out whenever a
 *    zone is picked (filter or the admin header) or the admin is city-limited.
 *
 * Dated by when the order was placed / the top-up was credited (IST days).
 */

export const ONLINE_METHODS = ['razorpay', 'razorpay_qr'];
export const RECEIVED_STATUSES = ['paid', 'authorized', 'refunded'];

const METHOD_LABELS = { razorpay: 'Razorpay', razorpay_qr: 'Razorpay QR' };

const onlineOrderWhere = (window, zoneId) => ({
    paymentMethod: { in: ONLINE_METHODS },
    paymentStatus: { in: RECEIVED_STATUSES },
    ...createdAtIn(window),
    ...(zoneId ? { zoneId } : {}),
});

const topupWhere = (window) => ({
    entityType: 'user',
    type: 'credit',
    status: 'completed',
    category: 'wallet_topup',
    ...createdAtIn(window),
    NOT: [
        { description: { startsWith: 'Cashback' } },
        { description: { startsWith: 'Top-up bonus' } },
        { description: { contains: '(dev)' } },
    ],
});

/** Whether top-ups can be shown: no zone picked, no city limit. */
const topupsVisible = (zoneId) => !zoneId && !currentAdminScope();

/** What an order brought in online, in rupees. Exported for tests. */
export function onlinePartOf(order) {
    const online = toPaise(order.onlineAmount);
    if (online > 0) return fromPaise(online);
    return fromPaise(Math.max(0, toPaise(order.total) - toPaise(order.walletAmount)));
}

const statusLabel = (order) => {
    if (order.paymentStatus === 'refunded') return 'Refunded';
    if (num(order.refundAmount) > 0) return 'Partly refunded';
    if (order.paymentStatus === 'authorized') return 'Authorized';
    return 'Paid';
};

/**
 * The totals: what the dashboard tile shows and the report's summary.
 * `window` is { gte, lte } (or null for all time), `zoneId` an id or null.
 */
export async function getOnlinePaymentsSummary({ window = null, zoneId = null } = {}) {
    const where = onlineOrderWhere(window, zoneId);
    const withTopups = topupsVisible(zoneId);
    const [split, whole, refunds, topups] = await Promise.all([
        prisma.foodOrder.aggregate({
            where: { ...where, onlineAmount: { gt: 0 } },
            _sum: { onlineAmount: true },
            _count: { _all: true },
        }),
        prisma.foodOrder.aggregate({
            where: { ...where, onlineAmount: { lte: 0 } },
            _sum: { total: true, walletAmount: true },
            _count: { _all: true },
        }),
        prisma.foodOrder.aggregate({
            where: { ...where, refundAmount: { gt: 0 } },
            _sum: { refundAmount: true },
            _count: { _all: true },
        }),
        withTopups
            ? prisma.transaction.aggregate({ where: topupWhere(window), _sum: { amount: true }, _count: { _all: true } })
            : null,
    ]);

    const ordersPaise = toPaise(split._sum.onlineAmount)
        + Math.max(0, toPaise(whole._sum.total) - toPaise(whole._sum.walletAmount));
    const orderCount = split._count._all + whole._count._all;
    const topupPaise = topups ? toPaise(topups._sum.amount) : 0;
    const topupCount = topups ? topups._count._all : 0;

    return {
        total: fromPaise(ordersPaise + topupPaise),
        count: orderCount + topupCount,
        orders: { count: orderCount, amount: fromPaise(ordersPaise) },
        topups: { included: withTopups, count: topupCount, amount: fromPaise(topupPaise) },
        refundedOnOrders: { count: refunds._count._all, amount: fromPaise(toPaise(refunds._sum.refundAmount)) },
    };
}

export async function getOnlinePaymentsReport(query = {}) {
    const window = resolveDayWindow(query);
    const range = window ? { from: window.fromDay, to: window.toDay } : null;
    const zoneId = await resolveZoneFilter(query);
    const { page, limit, skip } = pageOf(query, { defaultLimit: 100, maxLimit: 1000 });
    const kind = ['orders', 'topups'].includes(query.kind) ? query.kind : 'all';

    if (zoneId === null) {
        return {
            range,
            summary: { total: 0, count: 0, orders: { count: 0, amount: 0 }, topups: { included: false, count: 0, amount: 0 }, refundedOnOrders: { count: 0, amount: 0 } },
            payments: [],
            pagination: { page, limit, total: 0, pages: 1 },
        };
    }

    const summary = await getOnlinePaymentsSummary({ window, zoneId });
    const showOrders = kind !== 'topups';
    const showTopups = kind !== 'orders' && summary.topups.included;

    // Newest first across both sources: take enough of each to fill this page.
    const take = skip + limit;
    const [orders, topups] = await Promise.all([
        showOrders
            ? prisma.foodOrder.findMany({
                where: onlineOrderWhere(window, zoneId),
                orderBy: { createdAt: 'desc' },
                take,
                select: {
                    id: true, order_id: true, orderId: true, createdAt: true, userId: true,
                    customerName: true, customerPhone: true,
                    paymentMethod: true, paymentStatus: true, orderStatus: true,
                    total: true, walletAmount: true, onlineAmount: true, refundAmount: true,
                    razorpayPaymentId: true, razorpayOrderId: true, qr: true,
                    zone: { select: { name: true, zoneName: true } },
                    restaurant: { select: { restaurantName: true } },
                },
            })
            : [],
        showTopups
            ? prisma.transaction.findMany({
                where: topupWhere(window),
                orderBy: { createdAt: 'desc' },
                take,
                select: { id: true, entityId: true, amount: true, createdAt: true, metadata: true },
            })
            : [],
    ]);

    const userIds = [...new Set([
        ...orders.filter((o) => !o.customerName).map((o) => o.userId),
        ...topups.map((t) => t.entityId),
    ])];
    const users = userIds.length
        ? await prisma.foodUser.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, phone: true } })
        : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    const orderRows = orders.map((o) => {
        const user = userById.get(o.userId);
        const wallet = num(o.walletAmount) > 0;
        return {
            type: 'order',
            id: o.id,
            date: o.createdAt,
            orderId: o.order_id || o.orderId || o.id,
            customerName: o.customerName || user?.name || '',
            customerPhone: o.customerPhone || user?.phone || '',
            restaurant: o.restaurant?.restaurantName || '',
            zone: o.zone?.name || o.zone?.zoneName || '',
            amount: onlinePartOf(o),
            orderTotal: num(o.total),
            walletPart: num(o.walletAmount),
            refundAmount: num(o.refundAmount),
            method: `${METHOD_LABELS[o.paymentMethod] || o.paymentMethod}${wallet ? ' + Wallet' : ''}`,
            paymentId: o.razorpayPaymentId || o.qr?.paymentLinkId || o.razorpayOrderId || '',
            status: statusLabel(o),
            orderStatus: o.orderStatus,
        };
    });
    const topupRows = topups.map((t) => {
        const user = userById.get(t.entityId);
        return {
            type: 'topup',
            id: t.id,
            date: t.createdAt,
            orderId: 'Wallet top-up',
            customerName: user?.name || '',
            customerPhone: user?.phone || '',
            restaurant: '',
            zone: '',
            amount: num(t.amount),
            orderTotal: num(t.amount),
            walletPart: 0,
            refundAmount: 0,
            method: 'Razorpay (wallet top-up)',
            paymentId: t.metadata?.razorpayPaymentId || t.metadata?.razorpayOrderId || '',
            status: 'Credited',
            orderStatus: '',
        };
    });

    const payments = [...orderRows, ...topupRows]
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(skip, skip + limit);
    const total = (showOrders ? summary.orders.count : 0) + (showTopups ? summary.topups.count : 0);

    return {
        range,
        summary,
        payments,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    };
}
