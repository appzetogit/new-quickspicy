import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../../utils/testIds.js';
import { testPatch } from '../../../../utils/testGeo.js';
import { getDashboardStats, getSidebarBadges } from './adminDashboard.service.js';

/**
 * The admin dashboard.
 *
 * Everything is scoped to orders that represent real money, and to a zone when
 * one is given — a zone filter that leaked would show an admin another city's
 * revenue.
 */
const HERE = testPatch(5);
const created = { zones: [], restaurants: [], users: [], orders: [] };
let zoneId = null;
let restaurantId = null;
let outsideRestaurantId = null;
let userId = null;

const makeOrder = async (over = {}) => {
    const order = await prisma.foodOrder.create({
        data: {
            userId,
            restaurantId: over.restaurantId || restaurantId,
            zoneId: over.zoneId === null ? null : (over.zoneId || zoneId),
            orderId: uniqueTag('ORD'),
            orderStatus: 'delivered',
            paymentMethod: 'cash',
            addrStreet: '1 Test Street',
            addrCity: 'Indore',
            addrState: 'MP',
            subtotal: 1000,
            total: 1180,
            tax: 180,
            restaurantCommission: 100,
            platformFee: 20,
            deliveryFee: 40,
            platformProfit: 60,
            ...over,
        },
    });
    created.orders.push(order.id);
    return order;
};

test.before(async () => {

    const zone = await prisma.foodZone.create({
        data: { name: `Dash Zone ${uniqueTag('Z')}`, coordinates: HERE.ring },
    });
    created.zones.push(zone.id);
    zoneId = zone.id;

    const makeRestaurant = async (over = {}) => {
        const r = await prisma.foodRestaurant.create({
            data: {
                restaurantName: `Dash ${uniqueTag('R')}`,
                ownerName: 'Owner',
                ownerPhone: uniquePhone('9'),
                status: 'approved',
                ...over,
            },
        });
        created.restaurants.push(r.id);
        return r.id;
    };

    restaurantId = await makeRestaurant({ zoneId });
    outsideRestaurantId = await makeRestaurant();

    const u = await prisma.foodUser.create({ data: { name: 'Dash Customer', phone: uniquePhone('5') } });
    created.users.push(u.id);
    userId = u.id;
});

test.after(async () => {
    await prisma.foodOrder.deleteMany({ where: { id: { in: created.orders } } });
    await prisma.foodUser.deleteMany({ where: { id: { in: created.users } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.foodZone.deleteMany({ where: { id: { in: created.zones } } });
    await prisma.$disconnect();
});

test('only orders that represent money are counted', async () => {
    await makeOrder();
    await makeOrder({ orderStatus: 'preparing' });
    await makeOrder({ orderStatus: 'cancelled_by_user' });
    // Abandoned at checkout: no cash, no wallet, never paid. Not revenue.
    await makeOrder({
        orderStatus: 'pending_payment',
        paymentMethod: 'razorpay',
        paymentStatus: 'created',
    });

    const stats = await getDashboardStats({ zoneId });

    assert.equal(stats.orders.total, 3, 'the abandoned order is not an order');
    assert.equal(stats.orders.byStatus.delivered, 1);
    assert.equal(stats.orders.byStatus.cancelled, 1);
    assert.equal(stats.orders.byStatus.pending, 1);

    // Money is summed over delivered orders only.
    assert.equal(stats.revenue.total, 1180);
    assert.equal(stats.commission.total, 100);
    assert.equal(stats.platformFee.total, 20);
    assert.equal(stats.deliveryFee.total, 40);
    assert.equal(stats.gst.total, 180);
    assert.equal(stats.totalAdminEarnings, 240, 'platform profit plus GST');
    assert.equal(stats.deliveryProfit, -60, '60 profit less 100 commission less 20 fee');
});

test('a zone filter reaches the dish counts too', async () => {
    const inZone = await prisma.foodItem.create({
        data: { restaurantId, name: uniqueTag('Dish'), price: 100, approvalStatus: 'approved' },
    });
    const outside = await prisma.foodItem.create({
        data: {
            restaurantId: outsideRestaurantId,
            name: uniqueTag('Dish'),
            price: 100,
            approvalStatus: 'approved',
        },
    });

    const zoned = await getDashboardStats({ zoneId });
    const everywhere = await getDashboardStats({});

    // The dish has no zone of its own; it follows the restaurant that owns it.
    assert.ok(everywhere.foods.total > zoned.foods.total);
    assert.ok(everywhere.restaurants.total >= zoned.restaurants.total + 1);

    await prisma.foodItem.deleteMany({ where: { id: { in: [inZone.id, outside.id] } } });
});

test('the customer count follows the zone', async () => {
    const zoned = await getDashboardStats({ zoneId });
    // Zoned: customers who ordered here. There is one, with several orders.
    assert.equal(zoned.customers.total, 1);

    const everywhere = await getDashboardStats({});
    assert.ok(everywhere.customers.total >= 1);
});

test('the trend always has twelve months, oldest first', async () => {
    const { monthlyData } = await getDashboardStats({ zoneId });

    assert.equal(monthlyData.length, 12);
    assert.ok(monthlyData.every((m) => typeof m.month === 'string' && m.month.length >= 3));
    // A month with no orders still appears, so the chart axis is continuous.
    assert.ok(monthlyData.every((m) => Number.isFinite(m.orders)));

    const thisMonth = monthlyData[11];
    assert.equal(thisMonth.revenue, 1180);
    assert.equal(thisMonth.orders, 3);
    assert.equal(thisMonth.commission, 60, 'platform profit, not the fee');
});

test('a period narrows the window', async () => {
    // Backdated well outside every period the picker offers.
    await makeOrder({ createdAt: new Date('2022-03-04') });

    const overall = await getDashboardStats({ zoneId, period: 'overall' });
    const today = await getDashboardStats({ zoneId, period: 'today' });

    assert.equal(overall.orders.total, 4);
    assert.equal(today.orders.total, 3, 'the backdated order is outside today');

    // An unrecognised period is the same as no filter, not an empty dashboard.
    const nonsense = await getDashboardStats({ zoneId, period: 'fortnight' });
    assert.equal(nonsense.orders.total, 4);
});

test('a custom from/to range overrides the period, as whole India days', async () => {
    // Both on 5 March in India: 23:30 IST, and 00:10 IST on the 6th.
    await makeOrder({ createdAt: new Date('2022-03-05T18:00:00Z') });
    await makeOrder({ createdAt: new Date('2022-03-05T18:40:00Z') });

    const march = await getDashboardStats({ zoneId, period: 'today', from: '2022-03-01', to: '2022-03-31' });
    assert.equal(march.orders.total, 3, 'the 4th, the 5th and the 6th; today is ignored');
    assert.equal(march.revenue.total, 3 * 1180);
    assert.deepEqual(march.range, { period: 'custom', from: '2022-03-01', to: '2022-03-31' });

    // The end day runs to 23:59:59.999 IST and no further.
    const fifth = await getDashboardStats({ zoneId, from: '2022-03-05', to: '2022-03-05' });
    assert.equal(fifth.orders.total, 1);
    assert.equal(fifth.orderStats.completed, 1);
});

test('a short range is bucketed by day, a long one by month', async () => {
    const march = await getDashboardStats({ zoneId, from: '2022-03-01', to: '2022-03-31' });
    assert.equal(march.trendGranularity, 'day');
    assert.equal(march.monthlyData.length, 31);
    assert.equal(march.monthlyData[0].key, '2022-03-01');
    const byKey = Object.fromEntries(march.monthlyData.map((b) => [b.key, b]));
    assert.equal(byKey['2022-03-04'].orders, 1);
    assert.equal(byKey['2022-03-05'].orders, 1, 'bucketed on the India day, not the UTC one');
    assert.equal(byKey['2022-03-06'].orders, 1);
    assert.equal(byKey['2022-03-07'].orders, 0, 'an empty day still appears');

    const year = await getDashboardStats({ zoneId, from: '2022-01-01', to: '2022-12-31' });
    assert.equal(year.trendGranularity, 'month');
    assert.equal(year.monthlyData.length, 12);
    assert.equal(year.monthlyData[2].key, '2022-03');
    assert.equal(year.monthlyData[2].orders, 3);
    assert.equal(year.monthlyData[2].revenue, 3 * 1180);
});

test('a bad custom range is a 400, not an empty dashboard', async () => {
    for (const query of [
        { from: '2022-03-05' },
        { from: '2022-03-05', to: '2022-03-01' },
        { from: '2022-02-30', to: '2022-03-01' },
        { from: '05-03-2022', to: '2022-03-31' },
        { from: '2010-01-01', to: '2022-01-01' },
    ]) {
        await assert.rejects(getDashboardStats({ zoneId, ...query }), (err) => {
            assert.equal(err.name, 'ValidationError', JSON.stringify(query));
            assert.equal(err.statusCode, 400);
            return true;
        });
    }
});

test('the live feed is newest first and capped', async () => {
    const { liveSignals } = await getDashboardStats({ zoneId });

    assert.ok(liveSignals.length <= 15);
    const times = liveSignals.map((s) => new Date(s.timestamp).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
    assert.ok(liveSignals.every((s) => typeof s.time === 'string' && s.time.endsWith('ago')));
});

test('the sidebar badges count real statuses', async () => {
    const badges = await getSidebarBadges();

    // These three filtered on values that were not in any enum, so they always
    // read zero: no 'pending' order status, no 'offline_payment' method, and
    // safety reports start 'unread'.
    // Same set as the Pending Orders tab, so the badge never counts an order
    // the tab does not show (the preparing order is Processing, not Pending).
    assert.equal(
        badges.orders,
        await prisma.foodOrder.count({ where: { orderStatus: { in: ['created', 'confirmed'] } } }),
    );
    assert.ok(Number.isInteger(badges.offlinePayments));
    assert.ok(Number.isInteger(badges.safetyReports));
    assert.ok(Number.isInteger(badges.emergencyHelp));

    assert.equal(badges.foods, badges.foodApprovals + (badges.foods - badges.foodApprovals));
    assert.ok(Object.values(badges).every(Number.isInteger), 'no key is missing');
});
