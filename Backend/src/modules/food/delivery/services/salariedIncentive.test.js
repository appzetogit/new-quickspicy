import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import {
    SETTING_KEY,
    applySalariedPayRule,
    classifySalariedOrder,
    getSalariedStatus,
    normalizeSalariedSettings,
    resolveSalariedRule,
    saveSalariedIncentiveSettings,
} from './salariedIncentive.service.js';
import { getDeliveryPartnerEarnings, getDeliveryPartnerWallet } from './delivery.service.js';
import { uniquePhone } from '../../../../utils/testIds.js';

/**
 * Salaried rider incentive: the first N deliveries of a salaried rider's IST
 * day pay nothing (salary covers them), N+1 onward pay the normal earning.
 * The interesting tests are the money ones: the ledger copy moves with the
 * order, it happens once, and two deliveries finishing together still get
 * distinct places in the day.
 */
const created = { partners: [], restaurants: [], orders: [] };
const stamp = () => `${Date.now()}${Math.floor(performance.now() * 1000) % 1000}`;
let savedSetting;

test.before(async () => {
    savedSetting = await prisma.foodPlatformSetting.findUnique({ where: { key: SETTING_KEY } });
    await saveSalariedIncentiveSettings({ enabled: true, dailyThreshold: 2 });
});

test.after(async () => {
    await prisma.foodTransaction.deleteMany({ where: { orderId: { in: created.orders } } });
    await prisma.foodOrder.deleteMany({ where: { id: { in: created.orders } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.foodDeliveryPartner.deleteMany({ where: { id: { in: created.partners } } });
    if (savedSetting) {
        await prisma.foodPlatformSetting.update({ where: { key: SETTING_KEY }, data: { value: savedSetting.value } });
    } else {
        await prisma.foodPlatformSetting.deleteMany({ where: { key: SETTING_KEY } });
    }
    await prisma.$disconnect();
});

const makePartner = async (payType) => {
    const partner = await prisma.foodDeliveryPartner.create({
        data: { name: `Salaried Rider ${stamp()}`, phone: uniquePhone('6'), status: 'approved', payType },
    });
    created.partners.push(partner.id);
    return partner;
};

let fixture = null;
const restaurantAndUser = async () => {
    if (fixture) return fixture;
    const restaurant = await prisma.foodRestaurant.create({
        data: { restaurantName: `Salary Rest ${stamp()}`, ownerName: 'Owner', ownerPhone: uniquePhone('9'), status: 'approved' },
    });
    created.restaurants.push(restaurant.id);
    const user = await prisma.foodUser.create({ data: { phone: uniquePhone('5') } });
    fixture = { restaurant, user };
    return fixture;
};

/** A delivered order paying the rider `pay` + `tip`, with its ledger row. */
const makeDelivered = async (partner, { pay = 40, tip = 0, deliveredAt = new Date() } = {}) => {
    const { restaurant, user } = await restaurantAndUser();
    const order = await prisma.foodOrder.create({
        data: {
            userId: user.id,
            restaurantId: restaurant.id,
            dispatchDeliveryPartnerId: partner.id,
            orderStatus: 'delivered',
            paymentMethod: 'cash',
            addrStreet: '1 Test Street',
            addrCity: 'Indore',
            addrState: 'MP',
            subtotal: 200,
            total: 250,
            riderEarning: pay + tip,
            tipAmount: tip,
            platformProfit: 10,
            deliveredAt,
        },
    });
    created.orders.push(order.id);
    await prisma.foodTransaction.create({
        data: {
            orderId: order.id,
            userId: user.id,
            restaurantId: restaurant.id,
            paymentMethod: 'cash',
            totalCustomerPaid: 250,
            restaurantShare: 180,
            commissionAmount: 20,
            riderShare: pay + tip,
            platformNetProfit: 10,
        },
    });
    return order;
};

const reload = (id) => prisma.foodOrder.findUnique({ where: { id } });
const ledger = (orderId) => prisma.foodTransaction.findUnique({ where: { orderId } });

test('rule helpers: threshold, zone override, classification', () => {
    assert.equal(classifySalariedOrder(1, 2), 'salaried_covered');
    assert.equal(classifySalariedOrder(2, 2), 'salaried_covered');
    assert.equal(classifySalariedOrder(3, 2), 'salaried_incentive');

    const zoneId = 'a'.repeat(24);
    const settings = { enabled: true, dailyThreshold: 25, zones: { [zoneId]: { enabled: null, dailyThreshold: 10 } } };
    assert.deepEqual(resolveSalariedRule(settings, null), { enabled: true, dailyThreshold: 25, zoneOverride: false });
    assert.equal(resolveSalariedRule(settings, zoneId).dailyThreshold, 10);
    // A threshold of 0 is the rule switched off.
    assert.equal(resolveSalariedRule({ enabled: true, dailyThreshold: 0 }).enabled, false);
    assert.equal(normalizeSalariedSettings({ dailyThreshold: 'x' }).dailyThreshold, 0);
});

test('first N deliveries are covered by salary, N+1 pays as an incentive, ledger follows', async () => {
    const rider = await makePartner('salaried');
    const t0 = Date.now() - 60000;
    const o1 = await makeDelivered(rider, { pay: 40, deliveredAt: new Date(t0) });
    const o2 = await makeDelivered(rider, { pay: 40, tip: 15, deliveredAt: new Date(t0 + 1000) });
    const o3 = await makeDelivered(rider, { pay: 55, deliveredAt: new Date(t0 + 2000) });

    const r1 = await applySalariedPayRule(o1.id);
    const r2 = await applySalariedPayRule(o2.id);
    const r3 = await applySalariedPayRule(o3.id);
    assert.deepEqual([r1.basis, r1.seq, r1.waived], ['salaried_covered', 1, 40]);
    assert.deepEqual([r2.basis, r2.seq, r2.waived], ['salaried_covered', 2, 40]);
    assert.deepEqual([r3.basis, r3.seq, r3.waived], ['salaried_incentive', 3, 0]);

    // Covered: pay gone, tip kept, the difference is platform profit.
    const a1 = await reload(o1.id);
    assert.equal(Number(a1.riderEarning), 0);
    assert.equal(Number(a1.platformProfit), 50);
    const a2 = await reload(o2.id);
    assert.equal(Number(a2.riderEarning), 15);
    const t1 = await ledger(o1.id);
    assert.equal(Number(t1.riderShare), 0);
    assert.equal(Number(t1.platformNetProfit), 50);
    // The split still adds up: rider + restaurant + platform unchanged in total.
    assert.equal(Number(t1.riderShare) + Number(t1.platformNetProfit), 40 + 10);

    // Incentive: untouched.
    const a3 = await reload(o3.id);
    assert.equal(Number(a3.riderEarning), 55);
    assert.equal(Number((await ledger(o3.id)).riderShare), 55);

    // Earnings API: salaried status and today's progress.
    const status = await getSalariedStatus(rider.id);
    assert.equal(status.isSalaried, true);
    assert.equal(status.dailyThreshold, 2);
    assert.equal(status.todayOrders, 3);
    assert.equal(status.todayCoveredOrders, 2);
    assert.equal(status.todayIncentiveOrders, 1);
    assert.equal(status.ordersUntilIncentive, 0);
    assert.equal(status.todayIncentiveEarning, 55);

    const earnings = await getDeliveryPartnerEarnings(rider.id, { period: 'all' });
    assert.equal(earnings.payType, 'salaried');
    assert.equal(earnings.summary.totalEarnings, 70); // 0 + 15 tip + 55
    assert.equal(earnings.summary.salariedIncentive, 55);
    assert.equal(earnings.salaried.todayOrders, 3);

    // Wallet history labels the rows distinctly.
    const wallet = await getDeliveryPartnerWallet(rider.id);
    const rows = (wallet.transactions || []).filter((t) => t.type === 'payment');
    const row3 = rows.find((t) => t._id === o3.id);
    assert.ok(row3);
    {
        assert.equal(row3.category, 'salaried_incentive');
        assert.match(row3.description, /Salaried incentive/);
    }
});

test('applying twice changes nothing the second time', async () => {
    const rider = await makePartner('salaried');
    const o = await makeDelivered(rider, { pay: 30 });
    await applySalariedPayRule(o.id);
    const again = await applySalariedPayRule(o.id);
    assert.equal(again.already, true);
    assert.equal(Number((await reload(o.id)).riderEarning), 0);
    assert.equal(Number((await ledger(o.id)).riderShare), 0);
    assert.equal(Number((await reload(o.id)).riderPayWaived), 30);
});

test('deliveries finishing at once get distinct places in the day', async () => {
    const rider = await makePartner('salaried');
    const orders = [];
    for (let i = 0; i < 4; i += 1) orders.push(await makeDelivered(rider, { pay: 20 }));
    const results = await Promise.all(orders.map((o) => applySalariedPayRule(o.id)));
    const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
    assert.deepEqual(seqs, [1, 2, 3, 4]);
    assert.equal(results.filter((r) => r.basis === 'salaried_covered').length, 2);
    assert.equal(results.filter((r) => r.basis === 'salaried_incentive').length, 2);
});

test('gig riders are never touched', async () => {
    const rider = await makePartner('gig');
    const o = await makeDelivered(rider, { pay: 45 });
    assert.equal(await applySalariedPayRule(o.id), null);
    const after = await reload(o.id);
    assert.equal(after.riderPayBasis, null);
    assert.equal(Number(after.riderEarning), 45);
    assert.equal((await getSalariedStatus(rider.id)).isSalaried, false);
});

test('with the rule switched off salaried riders are paid per order', async () => {
    await saveSalariedIncentiveSettings({ enabled: false, dailyThreshold: 2 });
    try {
        const rider = await makePartner('salaried');
        const o = await makeDelivered(rider, { pay: 45 });
        assert.equal(await applySalariedPayRule(o.id), null);
        assert.equal(Number((await reload(o.id)).riderEarning), 45);
    } finally {
        await saveSalariedIncentiveSettings({ enabled: true, dailyThreshold: 2 });
    }
});
