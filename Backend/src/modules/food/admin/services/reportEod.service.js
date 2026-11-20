import { prisma } from '../../../../config/prisma.js';
import {
    addDays, createdAtIn, fromPaise, istDayOf, num, resolveDayWindow, resolveZoneFilter, toPaise,
} from './reportDays.js';

/**
 * End-of-day cumulative report: one row per India day, and the totals for the
 * range.
 *
 * Built on the same per-order money record (FoodTransaction) and the same
 * columns as the Transaction report (adminFinanceReport.service.js), so the
 * restaurant, admin and rider amounts here add up to what that report shows
 * for the same days and zone:
 *   restaurant amount  = restaurantShare
 *   platform commission = commissionAmount
 *   admin earning      = platformNetProfit
 *   rider earning      = riderShare
 *   order value        = totalCustomerPaid, or total when that is 0
 *   GST                = taxAmount, or tax when that is 0
 *   platform fee       = platformFee, or the gap in the pricing equation
 *
 * A day is the IST day the order's money record was created (when the order
 * was placed) -- the date the Transaction report filters on. Money columns
 * count delivered orders only; cancelled orders are counted separately.
 */

export const EOD_MAX_DAYS = 92;
export const EOD_DEFAULT_DAYS = 7;

const CANCELLED_STATUSES = ['cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin'];

/** The money fields of a day, in paise while summing. */
const MONEY_FIELDS = [
    'itemTotal', 'grossOrderValue', 'restaurantAmount', 'platformCommission', 'adminEarning',
    'riderEarning', 'deliveryCharges', 'platformFee', 'gst', 'discounts', 'refunds', 'cancelledValue',
];

const emptyDay = (day) => ({
    date: day,
    deliveredOrders: 0,
    cancelledOrders: 0,
    ...Object.fromEntries(MONEY_FIELDS.map((f) => [f, 0])),
});

/** Same fallback as the Transaction report's platformFee column. */
const platformFeeOf = (tx) => {
    const recorded = num(tx.platformFee);
    if (recorded) return recorded;
    return Math.max(0, num(tx.total) - num(tx.subtotal) - num(tx.packagingFee)
        - num(tx.deliveryFee) - num(tx.tax) + num(tx.discount));
};

/** One money record's contribution to its day (paise). Exported for tests. */
export function addToDay(day, tx) {
    const status = tx.order?.orderStatus;
    const orderAmount = toPaise(num(tx.totalCustomerPaid) || num(tx.total));
    if (CANCELLED_STATUSES.includes(status)) {
        day.cancelledOrders += 1;
        day.cancelledValue += orderAmount;
        return day;
    }
    if (status !== 'delivered') return day;
    day.deliveredOrders += 1;
    day.itemTotal += toPaise(tx.subtotal);
    day.grossOrderValue += orderAmount;
    day.restaurantAmount += toPaise(tx.restaurantShare);
    day.platformCommission += toPaise(tx.commissionAmount);
    day.adminEarning += toPaise(tx.platformNetProfit);
    day.riderEarning += toPaise(tx.riderShare);
    day.deliveryCharges += toPaise(tx.deliveryFee);
    day.platformFee += toPaise(platformFeeOf(tx));
    day.gst += toPaise(num(tx.taxAmount) || num(tx.tax));
    day.discounts += toPaise(tx.discount);
    day.refunds += toPaise(tx.order?.refundAmount);
    return day;
}

const toRupees = (row) => ({
    ...row,
    ...Object.fromEntries(MONEY_FIELDS.map((f) => [f, fromPaise(row[f])])),
});

/**
 * Build the day rows (every day of the window, oldest first, empty days
 * included), running totals and the range totals from money records.
 * Pure, so it is tested without a database.
 */
export function buildEodRows(window, transactions) {
    const byDay = new Map();
    for (let day = window.fromDay; day <= window.toDay; day = addDays(day, 1)) {
        byDay.set(day, emptyDay(day));
    }
    for (const tx of transactions) {
        const day = byDay.get(istDayOf(tx.createdAt));
        if (day) addToDay(day, tx);
    }

    const totals = emptyDay(null);
    const rows = [];
    for (const day of byDay.values()) {
        totals.deliveredOrders += day.deliveredOrders;
        totals.cancelledOrders += day.cancelledOrders;
        for (const f of MONEY_FIELDS) totals[f] += day[f];
        rows.push({
            ...toRupees(day),
            // Running totals since the first day of the range.
            cumulativeDeliveredOrders: totals.deliveredOrders,
            cumulativeGrossOrderValue: fromPaise(totals.grossOrderValue),
            cumulativeRestaurantAmount: fromPaise(totals.restaurantAmount),
            cumulativeAdminEarning: fromPaise(totals.adminEarning),
        });
    }
    const { date: _date, ...rest } = toRupees(totals);
    return { rows, totals: rest };
}

export async function getEodReport(query = {}) {
    const window = resolveDayWindow(query, { defaultDays: EOD_DEFAULT_DAYS, maxDays: EOD_MAX_DAYS });
    const zoneId = await resolveZoneFilter(query);

    const range = { from: window.fromDay, to: window.toDay, days: window.days };
    if (zoneId === null) {
        const empty = buildEodRows(window, []);
        return { range, zoneId: null, ...empty };
    }

    const and = [
        createdAtIn(window),
        { order: { orderStatus: { in: ['delivered', ...CANCELLED_STATUSES] } } },
    ];
    // As the Transaction report: the restaurant's zone, or the order's own
    // (a restaurant with no zone set still has orders in one).
    if (zoneId) and.push({ OR: [{ restaurant: { zoneId } }, { order: { zoneId } }] });

    // A row per order for at most EOD_MAX_DAYS days, numbers only. The admin
    // city scope applies through the Prisma extension (foodTransaction).
    const transactions = await prisma.foodTransaction.findMany({
        where: { AND: and },
        select: {
            createdAt: true,
            subtotal: true, packagingFee: true, deliveryFee: true, tax: true, taxAmount: true,
            platformFee: true, discount: true, total: true, totalCustomerPaid: true,
            restaurantShare: true, commissionAmount: true, riderShare: true, platformNetProfit: true,
            order: { select: { orderStatus: true, refundAmount: true } },
        },
    });

    return { range, zoneId: zoneId || null, ...buildEodRows(window, transactions) };
}
