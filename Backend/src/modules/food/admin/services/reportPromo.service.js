import { prisma } from '../../../../config/prisma.js';
import { isId } from '../../../../utils/helpers.js';
import { dayRange } from '../../../../utils/timezone.js';
import { currentAdminScope } from '../../../../core/roles/adminScope.context.js';

/**
 * Promo & discount usage report: per coupon, then the referral and cashback
 * money paid out in the same range. Built alongside couponOrderReport
 * (adminTools.service.js), which stays as it is for the Campaign Order page.
 *
 * Definitions
 *  - Redemption: an order placed with the coupon in the range that was not
 *    cancelled and not abandoned at checkout (pending_payment).
 *  - Discount / admin-funded / restaurant-funded: summed over redemptions.
 *    The split comes from the order's FoodTransaction (adminDiscountShare,
 *    restaurantDiscountShare); an order without one is split by the coupon's
 *    current adminBearPercentage / restaurantBearPercentage.
 *  - Revenue generated: what customers paid on delivered coupon orders, net of
 *    refunds (total - refundAmount).
 *  - ROI: (revenue generated - discount on those delivered orders) / that
 *    discount. 4.0 means every rupee of discount came with four more rupees of
 *    paid order value. Null when no discount was given.
 *  - Redemption rate: redemptions in the range / the coupon's usageLimit when
 *    one is set. How many customers saw or tried a coupon is not recorded
 *    (FoodOfferUsage counts only successful uses), so a rate against
 *    exposure cannot be computed.
 */

const num = (v) => Number(v ?? 0) || 0;
const money = (v) => Math.round(num(v) * 100) / 100;
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 100) / 100 : null);

const CANCELLED = ['cancelled_by_user', 'cancelled_by_restaurant', 'cancelled_by_admin'];
const NOT_PLACED = ['pending_payment'];

/** Folds coupon orders into one row per code. Pure, for the tests. */
export const summariseCoupons = (orders, offersByCode = new Map()) => {
    const rows = new Map();
    for (const o of orders) {
        const code = String(o.couponCode || '').trim().toUpperCase();
        if (!code) continue;
        const offer = offersByCode.get(code) || null;
        const row = rows.get(code) || {
            couponCode: code, offer, redemptions: 0, cancelled: 0, users: new Set(),
            discount: 0, adminFunded: 0, restaurantFunded: 0,
            deliveredOrders: 0, revenue: 0, deliveredDiscount: 0,
        };
        rows.set(code, row);
        if (NOT_PLACED.includes(o.orderStatus)) continue;
        if (CANCELLED.includes(o.orderStatus)) { row.cancelled += 1; continue; }
        const discount = num(o.discount);
        row.redemptions += 1;
        row.users.add(o.userId);
        row.discount += discount;
        const ft = o.foodTransaction;
        if (ft && num(ft.adminDiscountShare) + num(ft.restaurantDiscountShare) > 0) {
            row.adminFunded += num(ft.adminDiscountShare);
            row.restaurantFunded += num(ft.restaurantDiscountShare);
        } else {
            const adminPct = offer ? num(offer.adminBearPercentage) : 100;
            row.adminFunded += (discount * adminPct) / 100;
            row.restaurantFunded += discount - (discount * adminPct) / 100;
        }
        if (o.orderStatus === 'delivered') {
            row.deliveredOrders += 1;
            row.revenue += Math.max(0, num(o.total) - num(o.refundAmount));
            row.deliveredDiscount += discount;
        }
    }
    return [...rows.values()].map((r) => {
        const usageLimit = r.offer?.usageLimit > 0 ? r.offer.usageLimit : null;
        return {
            couponCode: r.couponCode,
            offerId: r.offer?.id || null,
            status: r.offer?.status || 'deleted',
            discountType: r.offer?.discountType || null,
            discountValue: r.offer ? money(r.offer.discountValue) : null,
            redemptions: r.redemptions,
            cancelledOrders: r.cancelled,
            uniqueCustomers: r.users.size,
            totalDiscount: money(r.discount),
            adminFunded: money(r.adminFunded),
            restaurantFunded: money(r.restaurantFunded),
            adminFundedPercent: pct(r.adminFunded, r.discount),
            restaurantFundedPercent: pct(r.restaurantFunded, r.discount),
            configuredAdminBearPercentage: r.offer ? num(r.offer.adminBearPercentage) : null,
            configuredRestaurantBearPercentage: r.offer ? num(r.offer.restaurantBearPercentage) : null,
            deliveredOrders: r.deliveredOrders,
            revenue: money(r.revenue),
            avgOrderValue: r.deliveredOrders ? money(r.revenue / r.deliveredOrders) : null,
            usageLimit,
            lifetimeUsed: r.offer ? r.offer.usedCount : null,
            redemptionRatePercent: usageLimit ? pct(r.redemptions, usageLimit) : null,
            roi: r.deliveredDiscount > 0 ? ratio(r.revenue - r.deliveredDiscount, r.deliveredDiscount) : null,
        };
    });
};

const placedOrderWhere = (extra = {}) => ({
    orderStatus: { notIn: [...CANCELLED, ...NOT_PLACED] },
    ...extra,
});

/** What a set of customers ordered: counts and delivered revenue. */
const ordersBy = async (where) => {
    const [placed, delivered] = await Promise.all([
        prisma.foodOrder.count({ where: placedOrderWhere(where) }),
        prisma.foodOrder.aggregate({
            where: { ...where, orderStatus: 'delivered' },
            _count: { _all: true },
            _sum: { total: true, refundAmount: true },
        }),
    ]);
    return {
        ordersPlaced: placed,
        ordersDelivered: delivered._count._all,
        revenue: money(Math.max(0, num(delivered._sum.total) - num(delivered._sum.refundAmount))),
    };
};

async function cashbackSection(range, zoneId) {
    const credits = await prisma.transaction.findMany({
        where: {
            entityType: 'user', type: 'credit', category: 'wallet_topup',
            description: { startsWith: 'Cashback' },
            ...(range ? { createdAt: range } : {}),
        },
        select: { entityId: true, amount: true, orderId: true, createdAt: true },
    });
    // The order each award was earned on, through the scoped client: a zone
    // filter (or a city-limited admin) keeps only awards on visible orders.
    const orderIds = [...new Set(credits.map((c) => c.orderId).filter(Boolean))];
    const zoneOrScope = Boolean(zoneId || currentAdminScope());
    const earnedOn = orderIds.length
        ? await prisma.foodOrder.findMany({
            where: { id: { in: orderIds }, ...(zoneId ? { zoneId } : {}) },
            select: { id: true, total: true, refundAmount: true },
        })
        : [];
    const visible = new Map(earnedOn.map((o) => [o.id, o]));
    const kept = zoneOrScope ? credits.filter((c) => c.orderId && visible.has(c.orderId)) : credits;

    // Follow-on orders: what each recipient ordered after their first award
    // in the range, up to the range end. A cashback cannot be tied to the
    // order it was spent on (the wallet is one balance), so this is the
    // closest measure of orders it produced.
    const firstAward = new Map();
    for (const c of kept) {
        const prev = firstAward.get(c.entityId);
        if (!prev || c.createdAt < prev) firstAward.set(c.entityId, c.createdAt);
    }
    let followOn = { ordersPlaced: 0, ordersDelivered: 0, revenue: 0 };
    if (firstAward.size) {
        const earliest = new Date(Math.min(...[...firstAward.values()].map((d) => new Date(d).getTime())));
        const later = await prisma.foodOrder.findMany({
            where: {
                userId: { in: [...firstAward.keys()] },
                createdAt: { gt: earliest, ...(range?.lte ? { lte: range.lte } : {}) },
                orderStatus: { notIn: [...CANCELLED, ...NOT_PLACED] },
                ...(zoneId ? { zoneId } : {}),
            },
            select: { userId: true, createdAt: true, orderStatus: true, total: true, refundAmount: true },
        });
        for (const o of later) {
            if (o.createdAt <= firstAward.get(o.userId)) continue;
            followOn.ordersPlaced += 1;
            if (o.orderStatus === 'delivered') {
                followOn.ordersDelivered += 1;
                followOn.revenue += Math.max(0, num(o.total) - num(o.refundAmount));
            }
        }
        followOn = { ...followOn, revenue: money(followOn.revenue) };
    }
    const paid = kept.reduce((s, c) => s + num(c.amount), 0);
    const earnedOnValue = kept.reduce((s, c) => {
        const o = c.orderId && visible.get(c.orderId);
        return s + (o ? Math.max(0, num(o.total) - num(o.refundAmount)) : 0);
    }, 0);
    return {
        amount: money(paid),
        awards: kept.length,
        customers: firstAward.size,
        earnedOnOrders: new Set(kept.map((c) => c.orderId).filter(Boolean)).size,
        earnedOnOrderValue: money(earnedOnValue),
        followOnOrders: followOn,
        roi: paid > 0 ? ratio(followOn.revenue - paid, paid) : null,
    };
}

async function referralSection(range) {
    const [userCredits, riderLogs] = await Promise.all([
        prisma.transaction.findMany({
            where: { entityType: 'user', type: 'credit', category: 'referral_reward', ...(range ? { createdAt: range } : {}) },
            select: { entityId: true, amount: true, metadata: true },
        }),
        prisma.foodReferralLog.findMany({
            where: { role: 'DELIVERY_PARTNER', status: 'credited', ...(range ? { createdAt: range } : {}) },
            select: { referrerId: true, refereeId: true, rewardAmount: true },
        }),
    ]);
    // A customer referral is paid at the new customer's sign-up; what it
    // produced is that customer's orders in the range.
    const referees = [...new Set(userCredits.map((c) => c.metadata?.refereeId).filter(isId))];
    const riderReferees = [...new Set(riderLogs.map((l) => l.refereeId).filter(isId))];
    const [customerOrders, riderDeliveries] = await Promise.all([
        referees.length
            ? ordersBy({ userId: { in: referees }, ...(range ? { createdAt: range } : {}) })
            : { ordersPlaced: 0, ordersDelivered: 0, revenue: 0 },
        riderReferees.length
            ? prisma.foodOrder.count({
                where: {
                    dispatchDeliveryPartnerId: { in: riderReferees },
                    orderStatus: 'delivered',
                    ...(range ? { deliveredAt: range } : {}),
                },
            })
            : 0,
    ]);
    const customerPaid = userCredits.reduce((s, c) => s + num(c.amount), 0);
    return {
        customer: {
            amount: money(customerPaid),
            rewards: userCredits.length,
            referrers: new Set(userCredits.map((c) => c.entityId)).size,
            referredCustomers: referees.length,
            ordersByReferred: customerOrders,
            roi: customerPaid > 0 ? ratio(customerOrders.revenue - customerPaid, customerPaid) : null,
        },
        rider: {
            amount: money(riderLogs.reduce((s, l) => s + num(l.rewardAmount), 0)),
            rewards: riderLogs.length,
            referredRiders: riderReferees.length,
            deliveriesByReferred: riderDeliveries,
        },
    };
}

/**
 * GET /admin/reports/promo-usage
 * Query: from, to (IST days, on order placed time), zoneId, couponCode.
 */
export async function promoUsageReport(q = {}) {
    const range = dayRange(q);
    const zoneId = isId(q.zoneId) ? String(q.zoneId) : null;
    const code = String(q.couponCode || '').trim();

    const orders = await prisma.foodOrder.findMany({
        where: {
            couponCode: code ? { equals: code, mode: 'insensitive' } : { not: null },
            ...(range ? { createdAt: range } : {}),
            ...(zoneId ? { zoneId } : {}),
        },
        select: {
            couponCode: true, userId: true, orderStatus: true, discount: true, total: true, refundAmount: true,
            foodTransaction: { select: { adminDiscountShare: true, restaurantDiscountShare: true } },
        },
    });

    const codes = [...new Set(orders.map((o) => String(o.couponCode || '').trim()).filter(Boolean))];
    const offerSelect = {
        id: true, couponCode: true, status: true, discountType: true, discountValue: true,
        usageLimit: true, usedCount: true, adminBearPercentage: true, restaurantBearPercentage: true,
    };
    const [offers, idleOffers] = await Promise.all([
        codes.length
            ? prisma.foodOffer.findMany({
                where: { couponCode: { in: [...new Set(codes.flatMap((c) => [c, c.toUpperCase(), c.toLowerCase()]))] } },
                select: offerSelect,
            })
            : [],
        // Live coupons nobody used are worth seeing too. Coupons are not
        // zone-bound, so only listed when the report is not narrowed to one.
        !zoneId && !code
            ? prisma.foodOffer.findMany({ where: { status: 'active' }, select: offerSelect })
            : [],
    ]);
    const offersByCode = new Map([...offers, ...idleOffers].map((o) => [o.couponCode.toUpperCase(), o]));

    const coupons = summariseCoupons(orders, offersByCode);
    const seen = new Set(coupons.map((c) => c.couponCode));
    for (const offer of idleOffers) {
        const key = offer.couponCode.toUpperCase();
        if (!seen.has(key)) coupons.push(...summariseCoupons([{ couponCode: key, orderStatus: 'pending_payment' }], offersByCode));
    }
    coupons.sort((a, b) => b.redemptions - a.redemptions || b.totalDiscount - a.totalDiscount);

    const t = coupons.reduce((s, c) => ({
        redemptions: s.redemptions + c.redemptions,
        totalDiscount: s.totalDiscount + c.totalDiscount,
        adminFunded: s.adminFunded + c.adminFunded,
        restaurantFunded: s.restaurantFunded + c.restaurantFunded,
        revenue: s.revenue + c.revenue,
        deliveredOrders: s.deliveredOrders + c.deliveredOrders,
    }), { redemptions: 0, totalDiscount: 0, adminFunded: 0, restaurantFunded: 0, revenue: 0, deliveredOrders: 0 });
    const uniqueCustomers = new Set(orders
        .filter((o) => !CANCELLED.includes(o.orderStatus) && !NOT_PLACED.includes(o.orderStatus))
        .map((o) => o.userId)).size;
    const deliveredDiscount = orders
        .filter((o) => o.orderStatus === 'delivered')
        .reduce((s, o) => s + num(o.discount), 0);

    const scoped = Boolean(zoneId || currentAdminScope());
    const [cashback, referral] = await Promise.all([
        cashbackSection(range, zoneId),
        // Referral rewards are paid at sign-up and belong to no zone.
        scoped ? null : referralSection(range),
    ]);

    return {
        range: range ? { from: range.gte || null, to: range.lte || null } : null,
        totals: {
            couponsUsed: coupons.filter((c) => c.redemptions > 0).length,
            redemptions: t.redemptions,
            uniqueCustomers,
            totalDiscount: money(t.totalDiscount),
            adminFunded: money(t.adminFunded),
            restaurantFunded: money(t.restaurantFunded),
            deliveredOrders: t.deliveredOrders,
            revenue: money(t.revenue),
            roi: deliveredDiscount > 0 ? ratio(t.revenue - deliveredDiscount, deliveredDiscount) : null,
        },
        coupons,
        cashback,
        referral,
        referralNote: referral ? null : 'Referral rewards are not tied to a zone, so they are shown only for all zones.',
        definitions: {
            redemption: 'An order placed with the coupon in the range, not cancelled and not abandoned at payment.',
            revenue: 'What customers paid on delivered coupon orders, net of refunds.',
            roi: '(Revenue generated - discount on those delivered orders) / that discount.',
            redemptionRate: 'Redemptions in the range / the coupon usage limit, when one is set. Views or attempts are not recorded.',
            cashbackFollowOn: 'Orders each cashback recipient placed after their first cashback in the range, up to the range end.',
            referralOrders: 'Orders placed in the range by customers whose referral reward was paid in the range.',
        },
    };
}
