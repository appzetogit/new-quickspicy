import { Prisma } from '@prisma/client';
import { prisma } from '../../../../config/prisma.js';
import { currentAdminScope } from '../../../../core/roles/adminScope.context.js';
import { isId } from '../../../../utils/helpers.js';
import { CANCELLED_ORDER_STATUSES } from '../../orders/services/order.helpers.js';
import { logger } from '../../../../utils/logger.js';
import { parseDayBound } from '../../../../utils/timezone.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { countLiveDeliveryAgents } from './reportDelivery.service.js';
import { getOnlinePaymentsSummary } from './reportOnlinePayments.service.js';
import { zoneMatch } from '../../shared/zoneHierarchy.js';

/**
 * The admin dashboard: headline totals over a preset period or a custom
 * from/to range, a trend bucketed by day or month, and the badge counts on the
 * sidebar.
 *
 * Every figure here is scoped to orders that represent real money — a customer
 * who abandoned checkout should not appear in a revenue chart.
 */

const PENDING_ORDER_STATUSES = ['created', 'confirmed', 'preparing', 'ready_for_pickup', 'picked_up'];

/**
 * Orders that count: paid for in cash or wallet (which settle on delivery), or
 * whose payment actually went through.
 *
 * The Mongo filter also listed 'captured' and 'settled', which were never
 * OrderPaymentStatus values — they belong to the transaction's own lifecycle,
 * so they matched nothing and are dropped rather than carried over.
 */
const REAL_ORDER = {
    OR: [
        { paymentMethod: { in: ['cash', 'wallet'] } },
        { paymentStatus: { in: ['paid', 'authorized', 'refunded'] } },
    ],
};

/*
 * Dates on the dashboard are India days. Days are handled as "YYYY-MM-DD"
 * strings and turned into instants by parseDayBound, which pins them to IST —
 * so "today" is the same day for an admin in Indore whatever the server's own
 * clock says. IST has no daylight saving, so a fixed offset is exact.
 */
const DAY_MS = 86400000;
const IST_OFFSET_MINUTES = 330;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Up to this many days the trend is drawn day by day; past it, by month. */
export const DAILY_BUCKET_MAX_DAYS = 62;
/** The widest custom range accepted: five years of monthly buckets. */
export const MAX_RANGE_DAYS = 366 * 5;

const istDay = (date = new Date()) =>
    new Date(date.getTime() + IST_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);
const dayUtc = (day) => Date.parse(`${day}T00:00:00Z`);
const addDays = (day, n) => new Date(dayUtc(day) + n * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (fromDay, toDay) => Math.round((dayUtc(toDay) - dayUtc(fromDay)) / DAY_MS);
const isRealDay = (raw) => {
    if (!DAY_RE.test(raw)) return false;
    const ms = dayUtc(raw);
    // "2026-02-30" parses, rolled over to March; the round trip catches it.
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === raw;
};
const lastDayOfMonth = (year, month /* 1-12 */) =>
    new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

const blank = (value) => value === undefined || value === null || String(value).trim() === '';

/** The preset periods, as IST day bounds. Unknown or overall: no window. */
const getDayRangeByPeriod = (period) => {
    const today = istDay();
    const [year, month] = today.split('-').map(Number);

    if (period === 'today') return { fromDay: today, toDay: today };
    if (period === 'week') {
        // Monday to Sunday, as payouts.
        const monday = addDays(today, -((new Date(dayUtc(today)).getUTCDay() + 6) % 7));
        return { fromDay: monday, toDay: addDays(monday, 6) };
    }
    if (period === 'month') {
        return { fromDay: `${today.slice(0, 7)}-01`, toDay: lastDayOfMonth(year, month) };
    }
    if (period === 'year') return { fromDay: `${year}-01-01`, toDay: `${year}-12-31` };
    return null;
};

/**
 * The window the dashboard covers.
 *
 * A custom `from`/`to` (YYYY-MM-DD, India days, both ends inclusive) wins over
 * `period`. Returns null for overall — no window at all.
 */
export const resolveDashboardRange = (query = {}) => {
    const period = String(query.period || 'overall').trim().toLowerCase();

    if (!blank(query.from) || !blank(query.to)) {
        const fromDay = String(query.from ?? '').trim();
        const toDay = String(query.to ?? '').trim();
        if (!fromDay || !toDay) throw new ValidationError('Both from and to dates are required');
        if (!isRealDay(fromDay) || !isRealDay(toDay)) {
            throw new ValidationError('Dates must be in YYYY-MM-DD format');
        }
        if (fromDay > toDay) throw new ValidationError('From date must be on or before the to date');
        if (daysBetween(fromDay, toDay) + 1 > MAX_RANGE_DAYS) {
            throw new ValidationError('Date range cannot be longer than five years');
        }
        return withInstants({ fromDay, toDay, period: 'custom' });
    }

    const preset = getDayRangeByPeriod(period);
    return preset ? withInstants({ ...preset, period }) : null;
};

const withInstants = (range) => ({
    ...range,
    start: parseDayBound(range.fromDay, 'start'),
    end: parseDayBound(range.toDay, 'end'),
});

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The empty buckets the trend is drawn over, oldest first — every day or month
 * appears, orders or not, so the chart axis is continuous.
 *
 * Overall: the last twelve months. A window of up to DAILY_BUCKET_MAX_DAYS
 * days: one bucket per day. Longer: one per month.
 */
export const trendBuckets = (range) => {
    if (range && daysBetween(range.fromDay, range.toDay) + 1 <= DAILY_BUCKET_MAX_DAYS) {
        const buckets = [];
        for (let day = range.fromDay; day <= range.toDay; day = addDays(day, 1)) {
            const [, m, d] = day.split('-').map(Number);
            buckets.push({ key: day, label: `${d} ${MONTH_NAMES[m - 1]}` });
        }
        return { granularity: 'day', buckets };
    }

    let firstMonth;
    let lastMonth;
    if (range) {
        firstMonth = range.fromDay.slice(0, 7);
        lastMonth = range.toDay.slice(0, 7);
    } else {
        lastMonth = istDay().slice(0, 7);
        const [y, m] = lastMonth.split('-').map(Number);
        firstMonth = new Date(Date.UTC(y, m - 12, 1)).toISOString().slice(0, 7);
    }

    const keys = [];
    for (let [y, m] = firstMonth.split('-').map(Number); ; ) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        keys.push(key);
        if (key >= lastMonth) break;
        m += 1;
        if (m > 12) { m = 1; y += 1; }
    }
    // A year in the label only when the axis crosses one.
    const oneYear = firstMonth.slice(0, 4) === lastMonth.slice(0, 4);
    const buckets = keys.map((key) => {
        const [y, m] = key.split('-');
        return { key, label: oneYear ? MONTH_NAMES[Number(m) - 1] : `${MONTH_NAMES[Number(m) - 1]} ${y.slice(2)}` };
    });
    return { granularity: 'month', buckets };
};

function formatTimeAgo(date) {
    if (!date) return '';
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    for (const [unit, size] of [
        ['year', 31536000], ['month', 2592000], ['day', 86400],
        ['hour', 3600], ['minute', 60],
    ]) {
        const interval = seconds / size;
        if (interval > 1) return `${Math.floor(interval)} ${unit}s ago`;
    }
    return `${Math.floor(seconds)} seconds ago`;
}

const num = (value) => Number(value) || 0;

/**
 * Orders per day or month across the dashboard's window (see trendBuckets),
 * with delivered revenue and platform take.
 *
 * Raw SQL because this groups by a derived value: Prisma's groupBy takes
 * columns, and there is no date_trunc in its API. "createdAt" holds UTC, so
 * it is shifted to India time before truncating — a 1 AM IST order belongs to
 * that day, not the one before.
 */
async function trend(where, range) {
    const { granularity, buckets } = trendBuckets(range);
    // Overall has no window of its own; the trend still stops at twelve months.
    const since = range ? null : parseDayBound(`${buckets[0].key}-01`, 'start');
    const truncated = granularity === 'day'
        ? Prisma.sql`date_trunc('day', "createdAt" + interval '330 minutes')`
        : Prisma.sql`date_trunc('month', "createdAt" + interval '330 minutes')`;

    // Raw SQL is not reached by the city scope, so it is applied by hand.
    const scope = currentAdminScope();
    const rows = await prisma.$queryRaw`
        SELECT ${truncated} AS bucket,
               COUNT(*)::int AS orders,
               COALESCE(SUM("total")    FILTER (WHERE "orderStatus" = 'delivered'), 0) AS revenue,
               -- platformProfit is the real take; platformFee is the fallback
               -- for orders written before the split was recorded.
               COALESCE(SUM(COALESCE(NULLIF("platformProfit", 0), "platformFee"))
                        FILTER (WHERE "orderStatus" = 'delivered'), 0) AS commission
        FROM "food_orders"
        WHERE (
              "paymentMethod" IN ('cash', 'wallet')
              OR "paymentStatus" IN ('paid', 'authorized', 'refunded')
          )
          ${since ? Prisma.sql`AND "createdAt" >= ${since}` : Prisma.empty}
          ${where.zoneId?.in ? Prisma.sql`AND "zoneId" = ANY(${where.zoneId.in})` : where.zoneId ? Prisma.sql`AND "zoneId" = ${where.zoneId}` : Prisma.empty}
          ${scope ? Prisma.sql`AND "zoneId" = ANY(${scope.zoneIds})` : Prisma.empty}
          ${where.createdAt?.gte ? Prisma.sql`AND "createdAt" >= ${where.createdAt.gte}` : Prisma.empty}
          ${where.createdAt?.lte ? Prisma.sql`AND "createdAt" <= ${where.createdAt.lte}` : Prisma.empty}
        GROUP BY 1
    `;

    // The bucket is an India wall-clock time with no zone, which the driver
    // reads as UTC — so its UTC date is the India day.
    const keyLength = granularity === 'day' ? 10 : 7;
    const byKey = new Map(rows.map((row) => [new Date(row.bucket).toISOString().slice(0, keyLength), row]));

    return {
        granularity,
        buckets: buckets.map(({ key, label }) => {
            const row = byKey.get(key);
            return {
                key,
                label,
                // `month` is what the chart reads as its axis; kept under that
                // name although a bucket may now be a day.
                month: label,
                orders: num(row?.orders),
                revenue: num(row?.revenue),
                commission: num(row?.commission),
            };
        }),
    };
}

/** The five customers who ordered most recently in a zone, newest first. */
async function recentZoneCustomers(orderWhere) {
    const latest = await prisma.foodOrder.groupBy({
        by: ['userId'],
        where: orderWhere,
        _max: { createdAt: true },
        orderBy: { _max: { createdAt: 'desc' } },
        take: 5,
    });
    const users = await prisma.foodUser.findMany({
        where: { id: { in: latest.map((r) => r.userId) } },
        select: { id: true, name: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return latest.filter((r) => byId.has(r.userId)).map((r) => ({ ...byId.get(r.userId), createdAt: r._max.createdAt }));
}

export async function getDashboardStats(query = {}) {
    // Throws a ValidationError (400) for a bad custom range.
    const range = resolveDashboardRange(query);
    const zoneId = isId(query.zoneId) ? String(query.zoneId) : null;

    const orderWhere = { ...REAL_ORDER };
    if (range) orderWhere.createdAt = { gte: range.start, lte: range.end };
    // A main zone includes its small zones.
    const zoneFilter = zoneId ? await zoneMatch(zoneId) : null;
    if (zoneId) orderWhere.zoneId = zoneFilter;

    // The "Online payments received" tile. Started now, awaited at the end; a
    // failure blanks the tile rather than the dashboard.
    const onlinePaymentsPending = getOnlinePaymentsSummary({
        window: range ? { gte: range.start, lte: range.end } : null,
        zoneId,
    }).catch((error) => {
        logger.error(`Dashboard online payments failed: ${error?.message || error}`);
        return null;
    });

    const restaurantWhere = zoneId ? { zoneId: zoneFilter } : {};
    // Menu counts follow the zone through the restaurant that owns the dish.
    const menuScope = zoneId ? { restaurant: { zoneId: zoneFilter } } : {};

    const [
        statusCounts,
        deliveredTotals,
        monthlyData,
        restaurantsTotal,
        restaurantsPending,
        deliveryTotal,
        deliveryPending,
        foodsTotal,
        addonsTotal,
        customersTotal,
        recentPendingRestaurants,
        recentPendingDelivery,
        recentPendingOrders,
        recentDeliveredOrders,
        recentCancelledOrders,
        recentCustomers,
        refunded,
    ] = await Promise.all([
        prisma.foodOrder.groupBy({ by: ['orderStatus'], where: orderWhere, _count: { _all: true } }),
        prisma.foodOrder.aggregate({
            where: { ...orderWhere, orderStatus: 'delivered' },
            _sum: {
                total: true, restaurantCommission: true, platformFee: true,
                deliveryFee: true, tax: true, platformProfit: true, refundAmount: true,
            },
        }),
        trend(orderWhere, range),
        prisma.foodRestaurant.count({ where: { ...restaurantWhere, status: 'approved' } }),
        prisma.foodRestaurant.count({ where: { ...restaurantWhere, status: 'pending' } }),
        // Zoned: riders whose home zone it is.
        prisma.foodDeliveryPartner.count({ where: { ...restaurantWhere, status: 'approved' } }),
        prisma.foodDeliveryPartner.count({ where: { status: 'pending' } }),
        prisma.foodItem.count({ where: { approvalStatus: 'approved', ...menuScope } }),
        prisma.foodAddon.count({ where: { approvalStatus: 'approved', isDeleted: false, ...menuScope } }),
        // Zoned: customers who ordered in this zone. Unzoned: everyone.
        // GROUP BY in the database: Prisma's distinct loaded every order.
        zoneId
            ? prisma.foodOrder.groupBy({ by: ['userId'], where: orderWhere }).then((rows) => rows.length)
            : prisma.foodUser.count(),
        prisma.foodRestaurant.findMany({
            where: { ...restaurantWhere, status: 'pending' },
            orderBy: { createdAt: 'desc' }, take: 5,
            select: { restaurantName: true, createdAt: true },
        }),
        prisma.foodDeliveryPartner.findMany({
            where: { status: 'pending' },
            orderBy: { createdAt: 'desc' }, take: 5,
            select: { name: true, createdAt: true },
        }),
        prisma.foodOrder.findMany({
            where: { ...orderWhere, orderStatus: { in: PENDING_ORDER_STATUSES } },
            orderBy: { createdAt: 'desc' }, take: 5,
            select: { orderId: true, createdAt: true },
        }),
        prisma.foodOrder.findMany({
            where: { ...orderWhere, orderStatus: 'delivered' },
            orderBy: { updatedAt: 'desc' }, take: 5,
            select: { orderId: true, updatedAt: true },
        }),
        prisma.foodOrder.findMany({
            where: { ...orderWhere, orderStatus: { in: CANCELLED_ORDER_STATUSES } },
            orderBy: { updatedAt: 'desc' }, take: 5,
            select: { orderId: true, updatedAt: true },
        }),
        zoneId
            ? recentZoneCustomers(orderWhere)
            : prisma.foodUser.findMany({
                orderBy: { createdAt: 'desc' }, take: 5,
                select: { name: true, phone: true, createdAt: true },
            }),
        // Orders with money refunded or on its way back, and how much.
        prisma.foodOrder.aggregate({
            where: { ...orderWhere, refundStatus: { in: ['processed', 'pending'] } },
            _count: { _all: true },
            _sum: { refundAmount: true },
        }),
    ]);

    const signal = (type, title, detail, timestamp) => ({
        type, title, detail, time: formatTimeAgo(timestamp), timestamp,
    });

    const liveSignals = [
        ...recentPendingRestaurants.map((r) =>
            signal('restaurant', 'New Restaurant Request', `${r.restaurantName} is waiting for approval`, r.createdAt)),
        ...recentPendingDelivery.map((d) =>
            signal('delivery', 'New Delivery Partner', `${d.name} requested to join`, d.createdAt)),
        ...recentPendingOrders.map((o) =>
            signal('order_pending', 'New Order Received', `Order #${o.orderId} is pending`, o.createdAt)),
        ...recentDeliveredOrders.map((o) =>
            signal('order_delivered', 'Order Delivered', `Order #${o.orderId} was successful`, o.updatedAt)),
        ...recentCancelledOrders.map((o) =>
            signal('order_cancelled', 'Order Cancelled', `Order #${o.orderId} was cancelled`, o.updatedAt)),
        ...recentCustomers.map((c) =>
            signal('customer', 'New Customer', `${c.name?.trim() || (c.phone ? `Customer ending ${String(c.phone).slice(-4)}` : 'A new customer')} just registered`, c.createdAt)),
    ]
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 15);

    const countFor = (statuses) => statusCounts
        .filter((row) => statuses.includes(row.orderStatus))
        .reduce((sum, row) => sum + row._count._all, 0);

    const totalOrders = statusCounts.reduce((sum, row) => sum + row._count._all, 0);
    const delivered = countFor(['delivered']);
    const cancelled = countFor(CANCELLED_ORDER_STATUSES);
    const pending = countFor(PENDING_ORDER_STATUSES);

    const sums = deliveredTotals._sum;
    // Riders online right now (not the period): see countLiveDeliveryAgents.
    // A failure blanks the tile rather than the dashboard.
    const liveDeliveryAgents = await countLiveDeliveryAgents(zoneId).catch((error) => {
        logger.error(`Dashboard live delivery agents failed: ${error?.message || error}`);
        return null;
    });
    // Net of what was refunded on those orders: that money went back.
    const revenueTotal = Math.max(0, num(sums.total) - num(sums.refundAmount));
    const commissionTotal = num(sums.restaurantCommission);
    const platformFeeTotal = num(sums.platformFee);
    const gstTotal = num(sums.tax);
    const adminNetProfit = num(sums.platformProfit);

    return {
        orders: { total: totalOrders, byStatus: { delivered, cancelled, pending, refunded: refunded._count._all } },
        refunds: { count: refunded._count._all, amount: num(refunded._sum.refundAmount) },
        revenue: { total: revenueTotal },
        commission: { total: commissionTotal },
        platformFee: { total: platformFeeTotal },
        deliveryFee: { total: num(sums.deliveryFee) },
        gst: { total: gstTotal },
        totalAdminEarnings: adminNetProfit + gstTotal,
        deliveryProfit: adminNetProfit - commissionTotal - platformFeeTotal,
        restaurants: { total: restaurantsTotal, pendingRequests: restaurantsPending },
        deliveryBoys: { total: deliveryTotal, pendingRequests: deliveryPending },
        liveDeliveryAgents,
        foods: { total: foodsTotal },
        addons: { total: addonsTotal },
        customers: { total: customersTotal },
        orderStats: { pending, completed: delivered },
        // The window every order figure above covers; null for overall.
        range: range ? { period: range.period, from: range.fromDay, to: range.toDay } : null,
        // Trend buckets, oldest first: days or months (trendGranularity).
        monthlyData: monthlyData.buckets,
        trendGranularity: monthlyData.granularity,
        liveSignals,
        // { total, count, orders, topups, refundedOnOrders }, or null if it failed.
        onlinePayments: await onlinePaymentsPending,
    };
}

/**
 * The numbers on the sidebar badges — everything waiting for an admin.
 *
 * Never throws: a failed count would blank the whole admin shell.
 */
export async function getSidebarBadges() {
    try {
        const [
            pendingRestaurants,
            pendingDeliveryPartners,
            pendingFoods,
            pendingAddons,
            pendingOrders,
            pendingOfflinePayments,
            pendingRestaurantWithdrawals,
            pendingDeliveryWithdrawals,
            openUserSupportTickets,
            openDeliverySupportTickets,
            pendingEarningAddons,
            pendingSafetyReports,
            pendingEmergencyHelp,
            pendingRestaurantComplaints,
            unreadChatMessages,
        ] = await Promise.all([
            prisma.foodRestaurant.count({ where: { status: 'pending' } }),
            prisma.foodDeliveryPartner.count({ where: { status: 'pending' } }),
            prisma.foodItem.count({ where: { approvalStatus: 'pending' } }),
            prisma.foodAddon.count({ where: { approvalStatus: 'pending' } }),
            // Both of these filtered on values that do not exist: there is no
            // 'pending' order status and no 'offline_payment' method, so Mongo
            // matched nothing and both badges have always read zero. Counted
            // against the real statuses now — orders awaiting action, and
            // orders waiting on a QR payment.
            // The badge sits on the Pending Orders tab, so it counts what that
            // tab lists (admin order list, status=pending): placed or accepted,
            // not started. Counting preparing/picked-up orders too left the
            // badge on 1 while the tab was empty.
            prisma.foodOrder.count({ where: { orderStatus: { in: ['created', 'confirmed'] } } }),
            prisma.foodOrder.count({ where: { paymentStatus: 'pending_qr' } }),
            prisma.foodRestaurantWithdrawal.count({ where: { status: 'pending' } }),
            prisma.foodDeliveryWithdrawal.count({ where: { status: 'pending' } }),
            // A customer's ticket has no restaurant attached; a restaurant's does.
            prisma.foodSupportTicket.count({ where: { status: 'open', restaurantId: null } }),
            prisma.deliverySupportTicket.count({ where: { status: 'open' } }),
            prisma.foodEarningAddonHistory.count({ where: { status: 'pending' } }),
            // Safety reports start 'unread', not 'pending'.
            prisma.foodSafetyEmergencyReport.count({ where: { status: 'unread' } }),
            // Counted against FoodDeliveryEmergencyHelp before, which holds the
            // helpline numbers rather than any request. The queue riders
            // actually raise is DeliveryOrderEmergencyRequest.
            prisma.deliveryOrderEmergencyRequest.count({ where: { status: 'open' } }),
            prisma.foodSupportTicket.count({ where: { status: 'open', restaurantId: { not: null } } }),
            // Every admin shares the "ADMIN" recipient token, so this is one
            // desk-wide number rather than a per-person inbox.
            prisma.foodChatMessage.count({ where: { recipientToken: 'ADMIN', readAt: null } }),
        ]);

        return {
            restaurants: pendingRestaurants,
            deliveryPartners: pendingDeliveryPartners,
            foods: pendingFoods + pendingAddons,
            foodApprovals: pendingFoods,
            orders: pendingOrders,
            offlinePayments: pendingOfflinePayments,
            restaurantWithdrawals: pendingRestaurantWithdrawals,
            deliveryWithdrawals: pendingDeliveryWithdrawals,
            userSupportTickets: openUserSupportTickets,
            deliverySupportTickets: openDeliverySupportTickets,
            earningAddons: pendingEarningAddons,
            safetyReports: pendingSafetyReports,
            emergencyHelp: pendingEmergencyHelp,
            restaurantComplaints: pendingRestaurantComplaints,
            liveChat: unreadChatMessages,
        };
    } catch (error) {
        logger.error('Error fetching sidebar badges:', error);
        return {};
    }
}
