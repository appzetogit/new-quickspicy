import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../../utils/testIds.js';
import { testPatch } from '../../../../utils/testGeo.js';
import { recordTransaction } from '../../../../core/payments/transaction.service.js';
import { buildEodRows, getEodReport } from './reportEod.service.js';
import { foldWalletGroups, getCustomerWalletReport } from './reportCustomerWallet.service.js';
import { getOnlinePaymentsReport, onlinePartOf } from './reportOnlinePayments.service.js';
import { resolveDayWindow } from './reportDays.js';
import { getTransactionReport } from './adminFinanceReport.service.js';
import { getDashboardStats } from './adminDashboard.service.js';

/**
 * EOD cumulative, customer wallet utilisation and online payments reports.
 * Everything is checked inside a zone (or a customer) this file creates, on a
 * day in the past, so other data in the database does not move the numbers.
 */
const tag = uniqueTag('MR');
const HERE = testPatch(11);
const DAY = '2025-03-10';
// 11:30 IST on DAY; and 00:30 IST on DAY, which is still the 9th in UTC.
const AT = new Date(`${DAY}T06:00:00Z`);
const EARLY = new Date('2025-03-09T19:00:00Z');
const created = { zones: [], restaurants: [], users: [], orders: [] };
let zoneId;
let restaurantId;
let user;
let seq = 0;

/** An order and its money record, both dated `at`. */
const makeOrder = async ({ at = AT, status = 'delivered', method = 'cash', paymentStatus = 'paid', wallet = 0, online = 0, total = 500, refund = 0 } = {}) => {
    const order = await prisma.foodOrder.create({
        data: {
            userId: user.id, restaurantId, zoneId,
            order_id: `${tag}${++seq}`,
            orderStatus: status, paymentMethod: method, paymentStatus,
            walletAmount: wallet, onlineAmount: online, refundAmount: refund,
            razorpayPaymentId: method === 'razorpay' ? `pay_${tag}${seq}` : null,
            addrStreet: '1 St', addrCity: 'Indore', addrState: 'MP',
            subtotal: 450, deliveryFee: 30, tax: 20, total, createdAt: at,
        },
    });
    created.orders.push(order.id);
    await prisma.foodTransaction.create({
        data: {
            orderId: order.id, userId: user.id, restaurantId, paymentMethod: method,
            status: status === 'delivered' ? 'captured' : 'pending',
            subtotal: 450, deliveryFee: 30, tax: 20, platformFee: 10, total, totalCustomerPaid: total,
            restaurantShare: 405, commissionAmount: 45, riderShare: 40, platformNetProfit: 15,
            createdAt: at,
        },
    });
    return order;
};

test.before(async () => {
    const zone = await prisma.foodZone.create({ data: { name: `${tag} Zone`, coordinates: HERE.ring } });
    zoneId = zone.id;
    created.zones.push(zone.id);
    const r = await prisma.foodRestaurant.create({
        data: { restaurantName: `${tag} Kitchen`, ownerName: 'O', ownerPhone: uniquePhone('9'), status: 'approved', zoneId },
    });
    restaurantId = r.id;
    created.restaurants.push(r.id);
    user = await prisma.foodUser.create({ data: { phone: uniquePhone('5'), name: `${tag} Customer` } });
    created.users.push(user.id);
});

test.after(async () => {
    const ids = created.orders;
    await prisma.foodTransactionHistory.deleteMany({ where: { transaction: { orderId: { in: ids } } } });
    await prisma.foodTransaction.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.transaction.deleteMany({ where: { entityType: 'user', entityId: { in: created.users } } });
    await prisma.wallet.deleteMany({ where: { entityType: 'user', entityId: { in: created.users } } }).catch(() => {});
    await prisma.foodOrder.deleteMany({ where: { id: { in: ids } } });
    await prisma.foodUser.deleteMany({ where: { id: { in: created.users } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.foodZone.deleteMany({ where: { id: { in: created.zones } } });
    await prisma.$disconnect();
});

// ─── pure ────────────────────────────────────────────────────────────────────

test('day windows are India days, and a range is capped', () => {
    const w = resolveDayWindow({ fromDate: '2025-03-01', toDate: '2025-03-03' });
    assert.equal(w.days, 3);
    assert.equal(w.gte.toISOString(), '2025-02-28T18:30:00.000Z');
    assert.equal(resolveDayWindow({}), null);
    assert.equal(resolveDayWindow({}, { defaultDays: 7 }).days, 7);
    assert.throws(() => resolveDayWindow({ fromDate: '2025-01-01', toDate: '2025-12-01' }, { maxDays: 92 }));
    assert.throws(() => resolveDayWindow({ fromDate: '2025-03-05', toDate: '2025-03-01' }));
});

test('EOD rows bucket by IST day, include empty days and run cumulative totals', () => {
    const w = resolveDayWindow({ fromDate: '2025-03-09', toDate: '2025-03-11' });
    const tx = (at, orderStatus) => ({
        createdAt: new Date(at), subtotal: 450, total: 500, totalCustomerPaid: 500, restaurantShare: 405,
        commissionAmount: 45, riderShare: 40, platformNetProfit: 15, deliveryFee: 30, tax: 20, taxAmount: 0,
        platformFee: 0, packagingFee: 0, discount: 0, order: { orderStatus, refundAmount: 0 },
    });
    const { rows, totals } = buildEodRows(w, [
        tx('2025-03-09T19:00:00Z', 'delivered'), // 10th, 00:30 IST
        tx('2025-03-10T10:00:00Z', 'cancelled_by_user'),
        tx('2025-03-11T05:00:00Z', 'delivered'),
    ]);
    assert.deepEqual(rows.map((r) => r.date), ['2025-03-09', '2025-03-10', '2025-03-11']);
    assert.equal(rows[0].deliveredOrders, 0);
    assert.equal(rows[1].deliveredOrders, 1);
    assert.equal(rows[1].cancelledOrders, 1);
    // No fee recorded: the pricing equation gives 500 - 450 - 30 - 20 = 0.
    assert.equal(rows[1].platformFee, 0);
    assert.equal(rows[2].cumulativeGrossOrderValue, 1000);
    assert.equal(totals.deliveredOrders, 2);
    assert.equal(totals.restaurantAmount, 810);
    assert.equal(totals.cancelledValue, 500);
});

test('wallet groups split cashback and bonus out of top-ups', () => {
    const byUser = foldWalletGroups([
        { entityId: 'u1', type: 'credit', category: 'wallet_topup', _sum: { amount: '300' }, _count: { _all: 3 } },
        { entityId: 'u1', type: 'credit', category: 'order_refund', _sum: { amount: '40' }, _count: { _all: 1 } },
        { entityId: 'u1', type: 'debit', category: 'order_payment', _sum: { amount: '120.50' }, _count: { _all: 1 } },
    ], [{ entityId: 'u1', _sum: { amount: '50' } }], [{ entityId: 'u1', _sum: { amount: '25' } }]);
    const u = byUser.get('u1');
    assert.equal(u.credits.topup, 22500);
    assert.equal(u.credits.cashback, 5000);
    assert.equal(u.credits.topupBonus, 2500);
    assert.equal(u.credits.refund, 4000);
    assert.equal(u.credited, 34000);
    assert.equal(u.spentOnOrders, 12050);
});

test('the online part of an order', () => {
    assert.equal(onlinePartOf({ onlineAmount: 0, total: '500', walletAmount: '120' }), 380);
    assert.equal(onlinePartOf({ onlineAmount: '380', total: 500, walletAmount: 120 }), 380);
    assert.equal(onlinePartOf({ onlineAmount: 0, total: 500, walletAmount: 0 }), 500);
});

// ─── against the database ────────────────────────────────────────────────────

test('EOD report for a zone and day, agreeing with the Transaction report', async () => {
    await makeOrder();
    await makeOrder({ at: EARLY });
    await makeOrder({ status: 'cancelled_by_restaurant', paymentStatus: 'cod_pending' });

    const report = await getEodReport({ fromDate: DAY, toDate: DAY, zoneId });
    assert.equal(report.rows.length, 1);
    const day = report.rows[0];
    assert.equal(day.deliveredOrders, 2, 'both delivered orders fall on the IST day');
    assert.equal(day.cancelledOrders, 1);
    assert.equal(day.grossOrderValue, 1000);
    assert.equal(day.restaurantAmount, 810);
    assert.equal(day.platformCommission, 90);
    assert.equal(day.deliveryCharges, 60);
    assert.equal(day.platformFee, 20);
    assert.equal(day.gst, 40);
    assert.equal(report.totals.adminEarning, 30);

    const tr = await getTransactionReport({
        zone: zoneId,
        fromDate: new Date(`${DAY}T00:00:00+05:30`).toISOString(),
        toDate: new Date(`${DAY}T23:59:59.999+05:30`).toISOString(),
    });
    assert.equal(tr.summary.restaurantEarning, report.totals.restaurantAmount);
    assert.equal(tr.summary.adminEarning, report.totals.adminEarning);
    assert.equal(tr.summary.deliverymanEarning, report.totals.riderEarning);
});

test('customer wallet report: credits by source, spend and balance per customer', async () => {
    const credit = (amount, category, description) => recordTransaction({
        entityType: 'user', entityId: user.id, type: 'credit', amount, category, description,
    });
    await credit(300, 'wallet_topup', 'Wallet top-up');
    await credit(50, 'wallet_topup', 'Cashback on order');
    await credit(20, 'referral_reward', 'Referral reward');
    await credit(15, 'adjustment', 'Added by admin: sorry');
    await recordTransaction({
        entityType: 'user', entityId: user.id, type: 'debit', amount: 100, category: 'order_payment', description: 'Order payment',
    });

    const report = await getCustomerWalletReport({ search: tag });
    assert.equal(report.customers.length, 1);
    const row = report.customers[0];
    assert.equal(row.credits.topup, 300);
    assert.equal(row.credits.cashback, 50);
    assert.equal(row.credits.referral, 20);
    assert.equal(row.credits.adminCredit, 15);
    assert.equal(row.credited, 385);
    assert.equal(row.spentOnOrders, 100);
    assert.equal(row.currentBalance, 285);
    assert.ok(report.summary.customersUsingWallet >= 1);
    assert.ok(report.creditsBySource.find((s) => s.key === 'topup').amount >= 300);
});

test('online payments: Razorpay and QR orders that were paid, at their online part', async () => {
    await makeOrder({ method: 'razorpay', total: 500 });
    await makeOrder({ method: 'razorpay', total: 500, wallet: 120, online: 380 });
    await makeOrder({ method: 'razorpay_qr', total: 200 });
    await makeOrder({ method: 'razorpay', paymentStatus: 'failed', status: 'cancelled_by_user' });

    const report = await getOnlinePaymentsReport({ fromDate: DAY, toDate: DAY, zoneId });
    assert.equal(report.summary.orders.count, 3);
    assert.equal(report.summary.orders.amount, 1080);
    assert.equal(report.summary.topups.included, false, 'top-ups have no zone');
    assert.equal(report.payments.length, 3);
    const split = report.payments.find((p) => p.method === 'Razorpay + Wallet');
    assert.equal(split.amount, 380);
    assert.ok(report.payments.every((p) => p.status === 'Paid'));

    const dash = await getDashboardStats({ from: DAY, to: DAY, zoneId });
    assert.equal(dash.onlinePayments.total, 1080, 'the dashboard tile agrees with the screen');
});
