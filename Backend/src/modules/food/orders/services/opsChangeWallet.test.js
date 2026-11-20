import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../../utils/testIds.js';
import { getBalance } from '../../../../core/payments/transaction.service.js';
import { buildInvoice, deliveryAddressParts, deliveryAddressLine } from './invoice.service.js';
import { buildDelayView } from './orderDelay.view.js';
import { reportRunningLate, flagDelayedOrders } from './orderDelay.service.js';
import {
    recordChangeOwed, approveChangeCredit, rejectChangeCredit, listChangeCredits,
    changeCreditDailySummary, approvedChangeByRider,
} from './changeCredit.service.js';
import {
    buildUpiUri, saveCompanyCollectionSettings, getCompanyCollectionSettings,
    confirmCompanyUpiPayment, reconcileUpiCollection, SETTINGS_KEY,
} from './companyCollection.service.js';
import { createCollectQr, switchToCash } from './order-payment.service.js';
import { getDeliveryPartnerWalletEnhanced } from '../../delivery/services/deliveryFinance.service.js';

/**
 * Invoice address, running late (rider/admin + watchdog), change to wallet
 * and the company UPI QR. Orders are written directly: these features start
 * after placement, so the pricing engine is not needed.
 */

const created = { restaurants: [], users: [], riders: [], orders: [] };
let tag;
let restaurantId;
let savedCollection = null;

async function newUser() {
    const u = await prisma.foodUser.create({ data: { name: `${tag} Customer`, phone: uniquePhone('5') } });
    created.users.push(u.id);
    return u.id;
}
async function newRider() {
    const r = await prisma.foodDeliveryPartner.create({ data: { name: `${tag} Rider`, phone: uniquePhone('8'), status: 'approved' } });
    created.riders.push(r.id);
    return r.id;
}
async function newOrder(data = {}) {
    const o = await prisma.foodOrder.create({
        data: {
            order_id: `T-${uniqueTag('O')}`.slice(0, 30),
            restaurantId,
            addrStreet: 'MG Road, near City Mall', addrAdditionalDetails: 'Flat 402, 4th Floor',
            addrCity: 'Indore', addrState: 'MP', addrZipCode: '452001',
            subtotal: 380, total: 380, paymentMethod: 'cash',
            ...data,
        },
    });
    created.orders.push(o.id);
    return o;
}

test.before(async () => {
    tag = uniqueTag('OCW');
    const restaurant = await prisma.foodRestaurant.create({
        data: { restaurantName: `${tag} Kitchen`, ownerName: 'Owner', ownerPhone: uniquePhone('9'), status: 'approved' },
    });
    created.restaurants.push(restaurant.id);
    restaurantId = restaurant.id;
    savedCollection = await prisma.foodPlatformSetting.findUnique({ where: { key: SETTINGS_KEY } });
});

test.after(async () => {
    const ids = created.orders;
    await prisma.foodChangeCredit.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.foodUpiCollection.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.foodOrderNotification.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.foodTransaction.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.transaction.deleteMany({ where: { entityId: { in: created.users } } });
    await prisma.transaction.updateMany({ where: { orderId: { in: ids } }, data: { orderId: null } });
    await prisma.wallet.deleteMany({ where: { entityId: { in: [...created.users, ...created.riders] } } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.foodOrder.deleteMany({ where: { id: { in: ids } } });
    await prisma.foodDeliveryPartner.deleteMany({ where: { id: { in: created.riders } } });
    await prisma.foodUser.deleteMany({ where: { id: { in: created.users } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    if (savedCollection) {
        await prisma.foodPlatformSetting.update({ where: { key: SETTINGS_KEY }, data: { value: savedCollection.value } });
    } else {
        await prisma.foodPlatformSetting.deleteMany({ where: { key: SETTINGS_KEY } });
    }
    await prisma.$disconnect();
});

// ── P1: the bill's address ────────────────────────────────────────────────────

test('the bill prints the whole address, house / flat / floor first', () => {
    const order = {
        order_id: 'FOD-1', createdAt: new Date(), subtotal: 100, total: 100,
        addrLabel: 'Home', addrAdditionalDetails: 'Flat 402, 4th Floor', addrStreet: 'MG Road, near City Mall',
        addrCity: 'Indore', addrState: 'MP', addrZipCode: '452001', deliveryInstructions: 'Ring twice',
        items: [],
    };
    const inv = buildInvoice({ order });
    assert.equal(inv.customer.address, 'Flat 402, 4th Floor, MG Road, near City Mall, Indore, MP - 452001');
    assert.deepEqual(inv.customer.addressParts, {
        label: 'Home', house: 'Flat 402, 4th Floor', street: 'MG Road, near City Mall', city: 'Indore', state: 'MP', pincode: '452001',
    });
    assert.equal(inv.customer.deliveryInstructions, 'Ring twice');
});

test('a house line already inside the street is printed once', () => {
    const parts = deliveryAddressParts({ addrAdditionalDetails: 'Plot 7', addrStreet: 'Plot 7, Vijay Nagar', addrCity: 'Indore' });
    assert.equal(deliveryAddressLine(parts), 'Plot 7, Vijay Nagar, Indore');
});

// ── P2: running late ──────────────────────────────────────────────────────────

test('buildDelayView is null until a delay is reported', () => {
    assert.equal(buildDelayView({}), null);
    const v = buildDelayView({ delayReportedAt: new Date(), delayReason: 'rain', delayExtraMinutes: 10, delayedUntil: new Date('2030-01-01T10:00:00Z') });
    assert.equal(v.reasonLabel, 'Rain');
    assert.equal(v.extraMinutes, 10);
    assert.equal(v.newEta, '2030-01-01T10:00:00.000Z');
});

test('the rider reports running late: ETA moves out, reason stored, cooldown and ownership enforced', async () => {
    const userId = await newUser();
    const riderId = await newRider();
    const eta = new Date(Date.now() + 10 * 60000);
    const order = await newOrder({ userId, orderStatus: 'picked_up', dispatchDeliveryPartnerId: riderId, estimatedDeliveryAt: eta });

    await assert.rejects(
        reportRunningLate({ orderId: order.id, reason: 'traffic', extraMinutes: 10, by: { role: 'DELIVERY_PARTNER', id: await newRider() } }),
        /Not your order/,
    );
    await assert.rejects(reportRunningLate({ orderId: order.id, reason: 'aliens', extraMinutes: 10, by: { role: 'DELIVERY_PARTNER', id: riderId } }), /reason/);
    await assert.rejects(reportRunningLate({ orderId: order.id, reason: 'other', extraMinutes: 10, by: { role: 'DELIVERY_PARTNER', id: riderId } }), /other/);
    await assert.rejects(reportRunningLate({ orderId: order.id, reason: 'rain', extraMinutes: 500, by: { role: 'DELIVERY_PARTNER', id: riderId } }), /extraMinutes/);

    const res = await reportRunningLate({ orderId: order.id, reason: 'traffic', extraMinutes: 15, note: 'Jam', by: { role: 'DELIVERY_PARTNER', id: riderId } });
    const row = await prisma.foodOrder.findUnique({ where: { id: order.id } });
    assert.equal(row.delayReason, 'traffic');
    assert.equal(row.delayExtraMinutes, 15);
    assert.equal(row.delayReportedBy, 'DELIVERY_PARTNER');
    assert.ok(Math.abs(row.delayedUntil.getTime() - (eta.getTime() + 15 * 60000)) < 2000, 'new ETA = old ETA + 15 min');
    assert.equal(row.estimatedDeliveryAt.getTime(), row.delayedUntil.getTime());
    assert.equal(res.delay.reason, 'traffic');

    await assert.rejects(
        reportRunningLate({ orderId: order.id, reason: 'rain', extraMinutes: 5, by: { role: 'ADMIN', id: null } }),
        /just sent/,
    );
});

test('a delivered order cannot be marked late', async () => {
    const order = await newOrder({ userId: await newUser(), orderStatus: 'delivered' });
    await assert.rejects(reportRunningLate({ orderId: order.id, reason: 'rain', extraMinutes: 5, by: { role: 'ADMIN' } }), /on its way/);
});

test('the watchdog apologises once for an order 10+ min past its promise', async () => {
    const userId = await newUser();
    const late = await newOrder({ userId, orderStatus: 'preparing', promisedDeliveryAt: new Date(Date.now() - 20 * 60000) });
    const onTime = await newOrder({ userId, orderStatus: 'preparing', promisedDeliveryAt: new Date(Date.now() - 5 * 60000) });
    // Told "running late" until later: not late yet.
    const announced = await newOrder({
        userId, orderStatus: 'picked_up', promisedDeliveryAt: new Date(Date.now() - 30 * 60000),
        delayedUntil: new Date(Date.now() + 5 * 60000), delayReportedAt: new Date(Date.now() - 20 * 60000),
    });

    await flagDelayedOrders({ orderIds: [late.id, onTime.id, announced.id] });
    const [a, b, c] = await Promise.all([late, onTime, announced].map((o) => prisma.foodOrder.findUnique({ where: { id: o.id } })));
    assert.ok(a.delayAutoNoticeAt, 'late order flagged');
    assert.equal(b.delayAutoNoticeAt, null);
    assert.equal(c.delayAutoNoticeAt, null);
    const first = a.delayAutoNoticeAt.getTime();

    await flagDelayedOrders({ orderIds: [late.id, onTime.id, announced.id] });
    const again = await prisma.foodOrder.findUnique({ where: { id: late.id } });
    assert.equal(again.delayAutoNoticeAt.getTime(), first, 'sent once');
    assert.equal(await prisma.foodOrderNotification.count({ where: { orderId: late.id, key: 'delayed' } }) <= 1, true);
});

// ── P3: change to wallet ──────────────────────────────────────────────────────

test('change owed: validated, approved into the customer wallet and the rider cash in hand', async () => {
    const userId = await newUser();
    const riderId = await newRider();
    const order = await newOrder({ userId, orderStatus: 'delivered', paymentStatus: 'paid', dispatchDeliveryPartnerId: riderId, deliveredAt: new Date() });

    await assert.rejects(recordChangeOwed(order.id, await newRider(), { amount: 120, cashCollected: 500 }), /Not your order/);
    await assert.rejects(recordChangeOwed(order.id, riderId, { amount: 600, cashCollected: 1000 }), /500/);
    await assert.rejects(recordChangeOwed(order.id, riderId, { amount: 150, cashCollected: 500 }), /below/);
    await assert.rejects(recordChangeOwed(order.id, riderId, { amount: 0, cashCollected: 500 }), /more than/);

    const before = await getDeliveryPartnerWalletEnhanced(riderId);
    const req = await recordChangeOwed(order.id, riderId, { amount: 100, cashCollected: 500, note: 'no change' });
    assert.equal(req.status, 'pending');
    // Corrected while pending.
    const fixed = await recordChangeOwed(order.id, riderId, { amount: 120, cashCollected: 500 });
    assert.equal(fixed.id, req.id);
    assert.equal(fixed.amount, 120);

    const pendingWallet = await getDeliveryPartnerWalletEnhanced(riderId);
    assert.equal(pendingWallet.cashInHand, before.cashInHand, 'pending changes nothing');

    const list = await listChangeCredits({ status: 'pending', limit: 200 });
    const item = list.items.find((i) => i.id === req.id);
    assert.ok(item);
    assert.equal(item.orderCashDue, 380);
    assert.equal(item.overpaid, 120);

    const userBefore = Number((await getBalance('user', userId)).balance);
    const approved = await approveChangeCredit(req.id, null);
    assert.equal(approved.status, 'approved');
    assert.ok(approved.walletTxnId);
    assert.equal(Number((await getBalance('user', userId)).balance), userBefore + 120);
    const txn = await prisma.transaction.findUnique({ where: { id: approved.walletTxnId } });
    assert.match(txn.description, /Change from order/);
    assert.equal(txn.category, 'adjustment');

    await assert.rejects(approveChangeCredit(req.id, null), /already approved/);
    assert.equal(Number((await getBalance('user', userId)).balance), userBefore + 120, 'credited once');

    const after = await getDeliveryPartnerWalletEnhanced(riderId);
    assert.equal(after.cashInHand, before.cashInHand + 120);
    assert.equal(after.changeKeptForCustomers, 120);
    assert.equal((await approvedChangeByRider([riderId])).get(riderId), 120);

    await assert.rejects(recordChangeOwed(order.id, riderId, { amount: 50, cashCollected: 500 }), /already approved/);

    const summary = await changeCreditDailySummary({});
    assert.ok(summary.approvedToday.amount >= 120);
});

test('a rejected request needs a reason and credits nothing', async () => {
    const userId = await newUser();
    const riderId = await newRider();
    const order = await newOrder({ userId, orderStatus: 'reached_drop', dispatchDeliveryPartnerId: riderId });
    const req = await recordChangeOwed(order.id, riderId, { amount: 20, cashCollected: 400 });
    await assert.rejects(rejectChangeCredit(req.id, null, ''), /reason/);
    const rejected = await rejectChangeCredit(req.id, null, 'Customer confirms change was given');
    assert.equal(rejected.status, 'rejected');
    assert.equal(Number((await getBalance('user', userId)).balance), 0);
    assert.equal((await approvedChangeByRider([riderId])).get(riderId), undefined);
});

test('change cannot be approved on an order not yet delivered', async () => {
    const riderId = await newRider();
    const order = await newOrder({ userId: await newUser(), orderStatus: 'picked_up', dispatchDeliveryPartnerId: riderId });
    const req = await recordChangeOwed(order.id, riderId, { amount: 20, cashCollected: 400 });
    await assert.rejects(approveChangeCredit(req.id, null), /delivered/);
});

test('change only on cash orders', async () => {
    const riderId = await newRider();
    const order = await newOrder({ userId: await newUser(), orderStatus: 'picked_up', paymentMethod: 'razorpay', dispatchDeliveryPartnerId: riderId });
    await assert.rejects(recordChangeOwed(order.id, riderId, { amount: 20, cashCollected: 400 }), /cash order/);
});

// ── D1: company UPI QR ────────────────────────────────────────────────────────

test('UPI deep link carries the exact amount and the order', () => {
    const uri = buildUpiUri({ upiId: 'qs@okaxis', payeeName: 'Quick Spicy', amount: 546, orderDisplayId: 'FOD-1', orderId: 'abc' });
    assert.equal(uri, 'upi://pay?pa=qs%40okaxis&pn=Quick%20Spicy&am=546.00&cu=INR&tn=Order%20FOD-1&tr=abc');
});

test('settings: validated, account number masked and kept when sent back masked', async () => {
    await assert.rejects(saveCompanyCollectionSettings({ upiId: 'not a vpa', payeeName: 'X' }), /UPI ID/);
    await assert.rejects(saveCompanyCollectionSettings({ upiId: 'qs@okaxis', payeeName: 'QS', bank: { ifsc: 'BAD' } }), /IFSC/);
    const saved = await saveCompanyCollectionSettings({
        useCompanyUpiQr: true, upiId: 'qs@okaxis', payeeName: 'Quick Spicy',
        bank: { accountHolderName: 'QS Ent', accountNumber: '123456789012', ifsc: 'HDFC0001234', bankName: 'HDFC' },
    });
    assert.equal(saved.bank.accountNumber, '••••9012');
    assert.equal(saved.activeMode, 'company_upi');
    await saveCompanyCollectionSettings({ ...saved, bank: { ...saved.bank } });
    const stored = await prisma.foodPlatformSetting.findUnique({ where: { key: SETTINGS_KEY } });
    assert.equal(stored.value.bank.accountNumber, '123456789012');
    assert.equal((await getCompanyCollectionSettings()).bank.accountNumber, '••••9012');
});

test('collect QR uses the company UPI; the rider confirms; finance reconciles', async () => {
    await saveCompanyCollectionSettings({ useCompanyUpiQr: true, upiId: 'qs@okaxis', payeeName: 'Quick Spicy' });
    const riderId = await newRider();
    const order = await newOrder({ userId: await newUser(), orderStatus: 'reached_drop', dispatchDeliveryPartnerId: riderId, total: 546, subtotal: 546 });

    const qr = await createCollectQr(order.id, riderId, {});
    assert.equal(qr.provider, 'company_upi');
    assert.match(qr.upiUri, /^upi:\/\/pay\?pa=qs%40okaxis/);
    assert.match(qr.upiUri, /am=546\.00/);
    let row = await prisma.foodOrder.findUnique({ where: { id: order.id } });
    assert.equal(row.paymentStatus, 'pending_qr');
    assert.equal(row.qr.provider, 'company_upi');

    await assert.rejects(reconcileUpiCollection(order.id, null, { outcome: 'reconciled' }), /not confirmed/);
    const confirmed = await confirmCompanyUpiPayment(order.id, riderId, { utr: '4123-5678' });
    assert.equal(confirmed.paymentStatus, 'paid');
    row = await prisma.foodOrder.findUnique({ where: { id: order.id } });
    assert.equal(row.paymentStatus, 'paid');
    assert.equal(row.qr.needsReconciliation, true);
    const col = await prisma.foodUpiCollection.findUnique({ where: { orderId: order.id } });
    assert.equal(col.status, 'rider_confirmed');
    assert.equal(col.utr, '41235678');

    await assert.rejects(reconcileUpiCollection(order.id, null, { outcome: 'mismatch' }), /does not match/);
    await reconcileUpiCollection(order.id, null, { outcome: 'reconciled' });
    row = await prisma.foodOrder.findUnique({ where: { id: order.id } });
    assert.equal(row.qr.needsReconciliation, false);
});

test('switching to cash after a company QR abandons it', async () => {
    await saveCompanyCollectionSettings({ useCompanyUpiQr: true, upiId: 'qs@okaxis', payeeName: 'Quick Spicy' });
    const riderId = await newRider();
    const order = await newOrder({ userId: await newUser(), orderStatus: 'reached_drop', dispatchDeliveryPartnerId: riderId });
    await createCollectQr(order.id, riderId, {});
    await switchToCash(order.id, riderId);
    const col = await prisma.foodUpiCollection.findUnique({ where: { orderId: order.id } });
    assert.equal(col.status, 'abandoned');
    const row = await prisma.foodOrder.findUnique({ where: { id: order.id } });
    assert.equal(row.paymentMethod, 'cash');
});
