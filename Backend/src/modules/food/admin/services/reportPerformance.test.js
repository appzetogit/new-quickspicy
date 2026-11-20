import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../../utils/testIds.js';
import { testPatch } from '../../../../utils/testGeo.js';
import {
    deliveryPerformanceReport, countLiveDeliveryAgents, orderTimings, promisedMinutes, unionMs,
    DEFAULT_LATE_AFTER_MINUTES,
} from './reportDelivery.service.js';
import { promoUsageReport, summariseCoupons } from './reportPromo.service.js';

/**
 * Delivery performance, promo usage and the live-riders tile.
 */
const HERE = testPatch(7);
const tag = uniqueTag('RP');
const created = { zones: [], restaurants: [], users: [], orders: [], riders: [], offers: [] };
let zoneId = null;
let restaurantId = null;
let userId = null;

const MIN = 60000;
const at = (base, minutes) => new Date(base.getTime() + minutes * MIN);

const makeOrder = async (over = {}) => {
    const { history = [], ...data } = over;
    const order = await prisma.foodOrder.create({
        data: {
            userId,
            restaurantId,
            zoneId,
            orderId: uniqueTag('ORD'),
            orderStatus: 'delivered',
            paymentMethod: 'cash',
            addrStreet: '1 Test Street',
            addrCity: 'Indore',
            addrState: 'MP',
            subtotal: 400,
            total: 450,
            ...data,
        },
    });
    created.orders.push(order.id);
    for (const h of history) {
        await prisma.orderStatusHistory.create({ data: { orderId: order.id, at: h.at, to: h.to, from: 'created' } });
    }
    return order;
};

const makeRider = async (over = {}) => {
    const r = await prisma.foodDeliveryPartner.create({
        data: { name: `${tag} Rider`, phone: uniquePhone('8'), status: 'approved', zoneId, ...over },
    });
    created.riders.push(r.id);
    return r;
};

test.before(async () => {
    const zone = await prisma.foodZone.create({ data: { name: `${tag} Zone`, coordinates: HERE.ring } });
    created.zones.push(zone.id);
    zoneId = zone.id;
    const r = await prisma.foodRestaurant.create({
        data: {
            restaurantName: `${tag} Kitchen`, ownerName: 'Owner', ownerPhone: uniquePhone('9'),
            status: 'approved', zoneId, estimatedDeliveryTime: '25-30 mins', estimatedDeliveryTimeMinutes: 25,
        },
    });
    created.restaurants.push(r.id);
    restaurantId = r.id;
    const u = await prisma.foodUser.create({ data: { name: `${tag} Customer`, phone: uniquePhone('5') } });
    created.users.push(u.id);
    userId = u.id;
});

test.after(async () => {
    await prisma.foodOrder.deleteMany({ where: { id: { in: created.orders } } });
    await prisma.foodDeliveryPartnerSession.deleteMany({ where: { deliveryPartnerId: { in: created.riders } } });
    await prisma.foodDeliveryPartner.deleteMany({ where: { id: { in: created.riders } } });
    await prisma.foodOffer.deleteMany({ where: { id: { in: created.offers } } });
    await prisma.foodUser.deleteMany({ where: { id: { in: created.users } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.foodZone.deleteMany({ where: { id: { in: created.zones } } });
    await prisma.$disconnect();
});

// ─── Pure pieces ─────────────────────────────────────────────────────────────

test('the promised time is the upper figure the restaurant shows', () => {
    assert.equal(promisedMinutes({ estimatedDeliveryTime: '25-30 mins' }), 30);
    assert.equal(promisedMinutes({ estimatedDeliveryTime: '1 hr' }), 60);
    assert.equal(promisedMinutes({ estimatedDeliveryTime: '', estimatedDeliveryTimeMinutes: 35 }), 35);
    assert.equal(promisedMinutes({}), null);
});

test('busy time counts overlapping orders once and clips to the window', () => {
    assert.equal(unionMs([[0, 10], [5, 15], [20, 30]], 0, 100), 25);
    assert.equal(unionMs([[0, 10]], 5, 100), 5);
    assert.equal(unionMs([], 0, 100), 0);
});

test('order timings: accept/ready to pickup, transit, total and lateness', () => {
    const t0 = new Date('2026-11-01T10:00:00Z');
    const t = orderTimings({
        createdAt: t0,
        pickedUpAt: at(t0, 20),
        deliveredAt: at(t0, 35),
        restaurant: { estimatedDeliveryTime: '25-30 mins' },
        statusHistory: [{ to: 'confirmed', at: at(t0, 2) }, { to: 'ready_for_pickup', at: at(t0, 15) }],
    });
    assert.equal(t.acceptToPickup, 18);
    assert.equal(t.readyToPickup, 5);
    assert.equal(t.transit, 15);
    assert.equal(t.total, 35);
    assert.equal(t.promised, 30);
    assert.equal(t.late, true);

    const fixed = orderTimings({ createdAt: t0, deliveredAt: at(t0, 35), restaurant: {} }, { lateAfterMinutes: 40 });
    assert.equal(fixed.late, false);
    const fallback = orderTimings({ createdAt: t0, deliveredAt: at(t0, DEFAULT_LATE_AFTER_MINUTES + 1), restaurant: {} });
    assert.equal(fallback.late, true);
    const scheduled = orderTimings({ createdAt: t0, scheduledAt: at(t0, 600), deliveredAt: at(t0, 620), restaurant: {} });
    assert.equal(scheduled.total, null, 'scheduled orders are not timed from placing');
    assert.equal(scheduled.late, null);
});

test('coupon rows: redemptions, funding split, revenue and ROI', () => {
    const offers = new Map([['SAVE', { id: 'x', couponCode: 'SAVE', usageLimit: 10, usedCount: 4, adminBearPercentage: 60, restaurantBearPercentage: 40, discountValue: 50 }]]);
    const [row] = summariseCoupons([
        { couponCode: 'save', userId: 'a', orderStatus: 'delivered', discount: 50, total: 450, refundAmount: 0 },
        { couponCode: 'SAVE', userId: 'a', orderStatus: 'delivered', discount: 50, total: 350, refundAmount: 50 },
        { couponCode: 'SAVE', userId: 'b', orderStatus: 'cancelled_by_user', discount: 50, total: 300 },
        { couponCode: 'SAVE', userId: 'c', orderStatus: 'pending_payment', discount: 50, total: 300 },
    ], offers);
    assert.equal(row.redemptions, 2);
    assert.equal(row.cancelledOrders, 1);
    assert.equal(row.uniqueCustomers, 1);
    assert.equal(row.totalDiscount, 100);
    assert.equal(row.adminFunded, 60);
    assert.equal(row.restaurantFunded, 40);
    assert.equal(row.revenue, 750);
    assert.equal(row.roi, 6.5);
    assert.equal(row.redemptionRatePercent, 20);
});

// ─── Against the database ────────────────────────────────────────────────────

test('delivery performance per rider, with utilisation from shifts', async () => {
    const rider = await makeRider();
    const t0 = new Date(Date.now() - 3 * 60 * MIN);
    await prisma.foodDeliveryPartnerSession.create({
        data: { deliveryPartnerId: rider.id, wentOnlineAt: t0, wentOfflineAt: at(t0, 120), durationMinutes: 120 },
    });
    // On time: 30 min against "25-30 mins".
    await makeOrder({
        dispatchDeliveryPartnerId: rider.id, createdAt: at(t0, 5), dispatchAcceptedAt: at(t0, 6),
        pickedUpAt: at(t0, 20), deliveredAt: at(t0, 35),
        history: [{ to: 'confirmed', at: at(t0, 7) }, { to: 'ready_for_pickup', at: at(t0, 18) }],
    });
    // Late: 50 min. Busy 60..110.
    await makeOrder({
        dispatchDeliveryPartnerId: rider.id, createdAt: at(t0, 60), dispatchAcceptedAt: at(t0, 60),
        pickedUpAt: at(t0, 80), deliveredAt: at(t0, 110),
    });

    const report = await deliveryPerformanceReport({ zoneId, deliveryPartnerId: rider.id });
    const row = report.riders.find((r) => r.deliveryPartnerId === rider.id);
    assert.equal(row.deliveries, 2);
    assert.equal(row.lateDeliveries, 1);
    assert.equal(row.avgTransitMinutes, 22.5);
    assert.equal(row.avgTotalMinutes, 40);
    assert.equal(row.avgReadyToPickupMinutes, 2);
    assert.equal(row.onlineMinutes, 120);
    assert.equal(row.busyMinutes, 29 + 50);
    assert.equal(row.utilisationPercent, 65.8);
    assert.equal(report.overall.deliveries, 2);
});

test('the live riders tile counts online riders with a recent location, by zone', async () => {
    const before = await countLiveDeliveryAgents(zoneId);
    await makeRider({ availabilityStatus: 'online', lastLocationAt: new Date() });
    await makeRider({ availabilityStatus: 'online', lastLocationAt: new Date(Date.now() - 2 * 60 * MIN) });
    await makeRider({ availabilityStatus: 'offline', lastLocationAt: new Date() });
    await makeRider({ availabilityStatus: 'online', lastLocationAt: new Date(), zoneId: null });
    const after = await countLiveDeliveryAgents(zoneId);
    assert.equal(after.live - before.live, 1);
    assert.equal(after.online - before.online, 2);
});

test('promo usage per coupon, narrowed to a zone', async () => {
    const code = `${tag}OFF`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40);
    const offer = await prisma.foodOffer.create({
        data: { couponCode: code, discountValue: 50, discountType: 'flat_price', usageLimit: 4, adminBearPercentage: 100, restaurantBearPercentage: 0 },
    });
    created.offers.push(offer.id);
    await makeOrder({ couponCode: code, discount: 50, total: 450 });
    await makeOrder({ couponCode: code, discount: 50, total: 450, orderStatus: 'cancelled_by_user' });

    const report = await promoUsageReport({ zoneId, couponCode: code });
    const row = report.coupons.find((c) => c.couponCode === code);
    assert.equal(row.redemptions, 1);
    assert.equal(row.cancelledOrders, 1);
    assert.equal(row.totalDiscount, 50);
    assert.equal(row.adminFunded, 50);
    assert.equal(row.revenue, 450);
    assert.equal(row.roi, 8);
    assert.equal(row.redemptionRatePercent, 25);
    assert.equal(report.referral, null, 'referrals are not zone-bound');
    assert.equal(report.cashback.awards, 0);
});
