import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../../utils/testIds.js';
import { testPatch } from '../../../../utils/testGeo.js';
import { getPopularItemsReport, fillHours } from './reportPopular.service.js';
import { getCancellationReport, cancellationActor, refundSummary } from './reportCancellation.service.js';
import { getInventoryReport } from './reportInventory.service.js';

/**
 * Popular items, cancellations and inventory reports. Everything is seeded in
 * a zone of its own and every report is asked for that zone only, so rows
 * from other test files never leak in.
 */
const HERE = testPatch(11);
const created = { zones: [], restaurants: [], users: [], orders: [], items: [] };
let zoneId = null;
let restaurantId = null;
let otherRestaurantId = null;
let userId = null;

// 10 Jan 2026 in India time.
const DAY = '2026-01-10';
const at = (hhmm) => new Date(`${DAY}T${hhmm}:00+05:30`);

const makeOrder = async (over = {}, items = []) => {
    const order = await prisma.foodOrder.create({
        data: {
            userId,
            restaurantId,
            zoneId,
            order_id: uniqueTag('QS'),
            orderStatus: 'delivered',
            paymentMethod: 'razorpay',
            paymentStatus: 'paid',
            addrStreet: '1 Test Street',
            addrCity: 'Indore',
            addrState: 'MP',
            subtotal: 300,
            total: 350,
            createdAt: at('13:30'),
            ...over,
            ...(items.length ? { items: { create: items } } : {}),
        },
    });
    created.orders.push(order.id);
    return order;
};

test.before(async () => {
    const zone = await prisma.foodZone.create({
        data: { name: `Report Zone ${uniqueTag('Z')}`, coordinates: HERE.ring },
    });
    created.zones.push(zone.id);
    zoneId = zone.id;

    for (const name of ['Biryani House', 'Pizza Point']) {
        const r = await prisma.foodRestaurant.create({
            data: {
                restaurantName: `${name} ${uniqueTag('R')}`,
                ownerName: 'Owner',
                ownerPhone: uniquePhone('9'),
                status: 'approved',
                zoneId,
            },
        });
        created.restaurants.push(r.id);
    }
    [restaurantId, otherRestaurantId] = created.restaurants;

    const u = await prisma.foodUser.create({ data: { phone: uniquePhone('5') } });
    created.users.push(u.id);
    userId = u.id;
});

test.after(async () => {
    await prisma.foodOrderRefund.deleteMany({ where: { orderId: { in: created.orders } } });
    await prisma.foodOrder.deleteMany({ where: { id: { in: created.orders } } });
    await prisma.foodItem.deleteMany({ where: { id: { in: created.items } } });
    await prisma.foodUser.deleteMany({ where: { id: { in: created.users } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.foodZone.deleteMany({ where: { id: { in: created.zones } } });
    await prisma.$disconnect();
});

test('fillHours always returns 24 IST buckets', () => {
    const hours = fillHours([{ hour: 13, orders: 2, revenue: '700' }]);
    assert.equal(hours.length, 24);
    assert.equal(hours[13].orders, 2);
    assert.equal(hours[13].revenue, 700);
    assert.equal(hours[0].orders, 0);
    assert.equal(hours[13].label, '13:00');
});

test('popular items count delivered orders only, by IST hour and zone', async () => {
    const biryani = { itemId: 'item-biryani', name: 'Chicken Biryani', price: 200, quantity: 2 };
    const raita = { itemId: 'item-raita', name: 'Raita', price: 50, quantity: 1 };
    await makeOrder({ total: 450 }, [biryani, raita]);
    await makeOrder({ total: 230, createdAt: at('20:15') }, [{ ...biryani, quantity: 1 }]);
    // Cancelled and in-progress orders do not count.
    await makeOrder({ orderStatus: 'cancelled_by_user' }, [{ ...biryani, quantity: 5 }]);
    await makeOrder({ orderStatus: 'preparing' }, [{ ...raita, quantity: 9 }]);
    // Outside the window.
    await makeOrder({ createdAt: new Date('2026-01-12T12:00:00+05:30') }, [{ ...raita, quantity: 9 }]);

    const report = await getPopularItemsReport({ from: DAY, to: DAY, zoneId });

    assert.equal(report.summary.deliveredOrders, 2);
    assert.equal(report.summary.revenue, 680);
    assert.equal(report.summary.itemsSold, 4);
    assert.equal(report.summary.peakHour.hour, 13);

    const [top, second] = report.topItems;
    assert.equal(top.name, 'Chicken Biryani');
    assert.equal(top.quantity, 3);
    assert.equal(top.revenue, 600);
    assert.equal(top.orders, 2);
    assert.equal(top.restaurantId, restaurantId);
    assert.equal(second.name, 'Raita');
    assert.equal(second.quantity, 1);

    assert.equal(report.peakHours.length, 24);
    assert.equal(report.peakHours[13].orders, 1);
    assert.equal(report.peakHours[20].orders, 1);

    assert.equal(report.zones.length, 1);
    assert.equal(report.zones[0].zoneId, zoneId);
    assert.equal(report.zones[0].orders, 2);
    assert.equal(report.zones[0].revenue, 680);
});

test('cancellationActor reads the history row, then the status', () => {
    assert.equal(cancellationActor('cancelled_by_user', { byRole: 'USER' }), 'customer');
    assert.equal(cancellationActor('cancelled_by_restaurant', { byRole: 'RESTAURANT' }), 'restaurant');
    assert.equal(cancellationActor('cancelled_by_restaurant', { byRole: 'SYSTEM', note: 'Not accepted by restaurant' }), 'restaurant');
    assert.equal(cancellationActor('cancelled_by_admin', { byRole: 'ADMIN', note: 'Customer asked' }), 'admin');
    assert.equal(cancellationActor('cancelled_by_admin', {
        byRole: 'SYSTEM', note: 'We could not find a delivery partner for this order, so it expired automatically.',
    }), 'delivery');
    assert.equal(cancellationActor('cancelled_by_admin', {
        byRole: 'SYSTEM', note: 'The restaurant did not respond in time, so this order expired automatically.',
    }), 'restaurant');
    assert.equal(cancellationActor('cancelled_by_admin', null), 'admin');
});

test('refundSummary ignores failed legs in the refunded figure', () => {
    const s = refundSummary({
        refundStatus: 'processed',
        refundLegs: [
            { amount: 100, status: 'processed' },
            { amount: 50, status: 'pending' },
            { amount: 70, status: 'failed' },
        ],
    });
    assert.equal(s.refunded, 150);
    assert.equal(s.failed, 70);
    assert.equal(refundSummary({ refundStatus: 'none', refundLegs: [] }).status, 'not_applicable');
});

test('cancellation report groups by actor, sums value and refunds, ranks reasons', async () => {
    const userCancel = await makeOrder({
        orderStatus: 'cancelled_by_user',
        total: 400,
        refundStatus: 'processed',
        createdAt: at('10:00'),
        statusHistory: { create: [{ byRole: 'USER', from: 'created', to: 'cancelled_by_user', note: 'Ordered by mistake' }] },
    });
    await prisma.foodOrderRefund.create({
        data: { orderId: userCancel.id, userId, source: 'online', refundTo: 'gateway', amount: 400, status: 'processed', initiatedBy: 'user' },
    });
    await makeOrder({
        orderStatus: 'cancelled_by_restaurant',
        total: 250,
        paymentMethod: 'cash',
        paymentStatus: 'cod_pending',
        createdAt: at('11:00'),
        statusHistory: { create: [{ byRole: 'RESTAURANT', from: 'created', to: 'cancelled_by_restaurant', note: 'Item out of stock' }] },
    });
    await makeOrder({
        orderStatus: 'cancelled_by_restaurant',
        total: 150,
        paymentMethod: 'cash',
        paymentStatus: 'cod_pending',
        createdAt: at('11:30'),
        statusHistory: { create: [{ byRole: 'RESTAURANT', from: 'created', to: 'cancelled_by_restaurant', note: 'item out of  stock' }] },
    });
    await makeOrder({
        orderStatus: 'cancelled_by_admin',
        total: 300,
        createdAt: at('12:00'),
        statusHistory: { create: [{
            byRole: 'SYSTEM', from: 'ready_for_pickup', to: 'cancelled_by_admin',
            note: 'We could not find a delivery partner for this order, so it expired automatically.',
        }] },
    });

    const report = await getCancellationReport({ from: DAY, to: DAY, zoneId });
    const actor = (a) => report.byActor.find((r) => r.actor === a);

    // The earlier test's cancelled_by_user order (no history) is in this zone too.
    assert.equal(report.summary.cancelledOrders, 5);
    assert.equal(actor('customer').count, 2);
    assert.equal(actor('restaurant').count, 2);
    assert.equal(actor('restaurant').valueLost, 400);
    assert.equal(actor('delivery').count, 1);
    assert.equal(actor('admin').count, 0);
    assert.equal(report.summary.refunded, 400);
    assert.equal(report.summary.refundProcessed, 400);

    // Whitespace and case do not split a reason.
    assert.equal(report.topReasons[0].reason, 'Item out of stock');
    assert.equal(report.topReasons[0].count, 2);

    const row = report.orders.find((o) => o.id === userCancel.id);
    assert.equal(row.actor, 'customer');
    assert.equal(row.reason, 'Ordered by mistake');
    assert.equal(row.refundStatus, 'processed');
    assert.equal(row.refunded, 400);

    const onlyRestaurant = await getCancellationReport({ from: DAY, to: DAY, zoneId, actor: 'restaurant' });
    assert.equal(onlyRestaurant.orders.length, 2);
    assert.ok(onlyRestaurant.orders.every((o) => o.actor === 'restaurant'));
    assert.ok(report.summary.cancellationRate > 0);
});

test('inventory report counts stock per restaurant and lists what is off', async () => {
    const future = new Date(Date.now() + 3 * 3600_000);
    const past = new Date(Date.now() - 3600_000);
    const make = async (data) => {
        const item = await prisma.foodItem.create({ data: { price: 100, approvalStatus: 'approved', ...data } });
        created.items.push(item.id);
        return item;
    };
    await make({ restaurantId, name: 'Available dish' });
    await make({ restaurantId, name: 'Manual off', isAvailable: false, stockOffMode: 'manual' });
    await make({ restaurantId, name: 'Back at six', isAvailable: false, stockResumeAt: future, stockOffMode: 'specific_time' });
    // Resume time already passed: switches back on at the next menu read.
    await make({ restaurantId, name: 'Overdue restore', isAvailable: false, stockResumeAt: past, stockOffMode: 'specific_time' });
    // Not approved: not on the menu, not counted.
    await make({ restaurantId, name: 'Pending dish', isAvailable: false, approvalStatus: 'pending' });
    await make({ restaurantId: otherRestaurantId, name: 'Other available' });

    const report = await getInventoryReport({ zoneId });
    const mine = report.restaurants.find((r) => r.restaurantId === restaurantId);
    assert.equal(mine.totalItems, 4);
    assert.equal(mine.outOfStock, 2);
    assert.equal(mine.available, 2);
    assert.equal(mine.timedResume, 1);
    assert.equal(mine.manualOff, 1);
    // Most stockouts first.
    assert.equal(report.restaurants[0].restaurantId, restaurantId);

    assert.equal(report.summary.totalItems, 5);
    assert.equal(report.summary.outOfStock, 2);
    assert.equal(report.summary.restaurantsWithStockouts, 1);

    const names = report.outOfStockItems.map((i) => i.name).sort();
    assert.deepEqual(names, ['Back at six', 'Manual off']);
    const timed = report.outOfStockItems.find((i) => i.name === 'Back at six');
    assert.equal(timed.resumesAt.getTime(), future.getTime());
    assert.ok(timed.lastUpdatedAt instanceof Date);
    assert.equal(report.history, null);

    const one = await getInventoryReport({ zoneId, restaurantId: otherRestaurantId });
    assert.equal(one.restaurants.length, 1);
    assert.equal(one.summary.outOfStock, 0);
});
