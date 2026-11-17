import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../../utils/testIds.js';
import { testPatch } from '../../../../utils/testGeo.js';
import { recordTransaction, getBalance } from '../../../../core/payments/transaction.service.js';
import { calculateOrder, createOrder, cancelOrder, processRefundAdmin, planWalletCashSplit } from './order.service.js';
import { paidParts } from './order-refund.service.js';
import { sanitizeOrderForDeliveryPartner, cashToCollect } from './order.helpers.js';
import { toOrder, orderInclude } from '../order.mapper.js';
import { getDeliveryPartnerWalletEnhanced } from '../../delivery/services/deliveryFinance.service.js';

/**
 * Wallet + cash on delivery: the wallet pays what it can when the order is
 * placed, the rider collects only the rest.
 *
 * The rules every test checks: the customer pays the total exactly once (wallet
 * part + cash part), the rider is asked for and credited with the cash part
 * only, and a cancelled order hands back exactly the wallet part.
 */
const HERE = testPatch(9);
const created = { zones: [], restaurants: [], users: [], foods: [], categories: [], riders: [] };
let restaurantId = null;
let foodId = null;
let tag = null;

const address = () => ({
    label: 'Home', fullName: 'Test Customer', street: '1 Test Street', city: 'Indore',
    state: 'MP', zipCode: '452001', phone: uniquePhone('5'), latitude: HERE.lat, longitude: HERE.lng,
});

// 2 x ₹250 dishes; the exact total (fees, tax) comes from the pricing engine.
const cart = (extra = {}) => ({
    restaurantId,
    items: [{ itemId: foodId, quantity: 2 }],
    address: address(),
    paymentMethod: 'cash',
    ...extra,
});

async function customerWithWallet(rupees) {
    const user = await prisma.foodUser.create({ data: { name: `${tag} Customer`, phone: uniquePhone('5') } });
    created.users.push(user.id);
    if (rupees > 0) {
        await recordTransaction({
            entityType: 'user', entityId: user.id, type: 'credit', amount: rupees,
            description: 'Test top-up', category: 'wallet_topup',
        });
    }
    return user.id;
}

const walletOf = async (userId) => Number((await getBalance('user', userId)).balance);
const orderRow = (id) => prisma.foodOrder.findUnique({ where: { id }, include: { refundLegs: true } });
const paise = (n) => Math.round(Number(n) * 100);
const idOf = (placed) => placed?.order?.id || placed?.order?._id || placed?.id || placed?._id;

test.before(async () => {
    tag = uniqueTag('WCod');
    const zone = await prisma.foodZone.create({ data: { name: `${tag} Zone`, coordinates: HERE.ring, isActive: true } });
    created.zones.push(zone.id);
    const restaurant = await prisma.foodRestaurant.create({
        data: {
            restaurantName: `${tag} Kitchen`, ownerName: 'Owner', ownerPhone: uniquePhone('9'),
            status: 'approved', zoneId: zone.id, latitude: HERE.lat, longitude: HERE.lng,
            isAcceptingOrders: true, outsideHoursOverride: true,
        },
    });
    created.restaurants.push(restaurant.id);
    restaurantId = restaurant.id;
    const category = await prisma.foodCategory.create({ data: { name: `${tag} Mains`, restaurantId, approvalStatus: 'approved' } });
    created.categories.push(category.id);
    const food = await prisma.foodItem.create({
        data: {
            restaurantId, categoryId: category.id, categoryName: category.name,
            name: `${tag} Biryani`, price: 250, approvalStatus: 'approved', isAvailable: true,
        },
    });
    created.foods.push(food.id);
    foodId = food.id;
});

test.after(async () => {
    const orders = await prisma.foodOrder.findMany({ where: { restaurantId: { in: created.restaurants } }, select: { id: true } });
    const ids = orders.map((o) => o.id);
    await prisma.foodOrderRefund.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.foodTransaction.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.transaction.deleteMany({ where: { entityId: { in: created.users } } });
    await prisma.transaction.updateMany({ where: { orderId: { in: ids } }, data: { orderId: null } });
    await prisma.wallet.deleteMany({ where: { entityId: { in: [...created.users, ...created.riders] } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.foodOrder.deleteMany({ where: { id: { in: ids } } });
    await prisma.foodDeliveryPartner.deleteMany({ where: { id: { in: created.riders } } });
    await prisma.foodItem.deleteMany({ where: { id: { in: created.foods } } });
    await prisma.foodCategory.deleteMany({ where: { id: { in: created.categories } } });
    await prisma.foodUser.deleteMany({ where: { id: { in: created.users } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.foodZone.deleteMany({ where: { id: { in: created.zones } } });
    await prisma.$disconnect();
});

test('the split: wallet pays what it can, no ₹1 floor on the cash part', async () => {
    const userId = await customerWithWallet(100);
    assert.deepEqual(await planWalletCashSplit(userId, 300), { coversAll: false, walletPaise: 10000, cashPaise: 20000 });
    assert.deepEqual(await planWalletCashSplit(userId, 100.5), { coversAll: false, walletPaise: 10000, cashPaise: 50 });
    assert.deepEqual(await planWalletCashSplit(userId, 80), { coversAll: true, walletPaise: 8000, cashPaise: 0 });
});

test('the checkout preview shows the wallet part and the cash the rider collects', async () => {
    const userId = await customerWithWallet(100);
    const preview = await calculateOrder(userId, cart());
    const total = paise(preview.pricing.total);
    assert.equal(preview.wallet.withCash.walletAmount, 100);
    assert.equal(paise(preview.wallet.withCash.cashAmount), total - 10000);
    assert.equal(preview.wallet.withCash.coversAll, false);
});

test('placing it takes the wallet part now and leaves only the rest to collect', async () => {
    const userId = await customerWithWallet(100);
    const placed = await createOrder(userId, cart({ useWallet: true }));
    const row = await orderRow(idOf(placed));
    const total = paise(row.total);

    assert.equal(row.paymentMethod, 'cash');
    assert.equal(row.paymentStatus, 'cod_pending');
    assert.equal(row.orderStatus, 'created', 'goes straight to the restaurant, nothing to pay online');
    assert.equal(paise(row.walletAmount), 10000);
    assert.equal(paise(row.onlineAmount), 0);
    assert.equal(paise(row.paymentAmountDue), total - 10000, 'amount due is the cash part');
    assert.equal(await walletOf(userId), 0, 'wallet debited once');

    // What the rider app is told to collect.
    const forRider = sanitizeOrderForDeliveryPartner(toOrder(await prisma.foodOrder.findUnique({ where: { id: row.id }, include: orderInclude })));
    assert.equal(paise(forRider.cashToCollect), total - 10000);
    assert.equal(forRider.paidFromWallet, 100);
});

test('a wallet that covers the whole order makes it a wallet order', async () => {
    const userId = await customerWithWallet(5000);
    const placed = await createOrder(userId, cart({ useWallet: true }));
    const row = await orderRow(idOf(placed));
    assert.equal(row.paymentMethod, 'wallet');
    assert.equal(row.paymentStatus, 'paid');
    assert.equal(paise(await walletOf(userId)), 500000 - paise(row.total));
    assert.equal(cashToCollect(toOrder(await prisma.foodOrder.findUnique({ where: { id: row.id }, include: orderInclude }))), 0);
});

test('an empty wallet leaves a plain cash order', async () => {
    const userId = await customerWithWallet(0);
    const placed = await createOrder(userId, cart({ useWallet: true }));
    const row = await orderRow(idOf(placed));
    assert.equal(row.paymentMethod, 'cash');
    assert.equal(paise(row.walletAmount), 0);
    assert.equal(paise(row.paymentAmountDue), paise(row.total));
});

test('without useWallet a cash order never touches the wallet', async () => {
    const userId = await customerWithWallet(100);
    const placed = await createOrder(userId, cart());
    const row = await orderRow(idOf(placed));
    assert.equal(paise(row.walletAmount), 0);
    assert.equal(await walletOf(userId), 100);
});

test('cancelling before delivery hands back exactly the wallet part, once', async () => {
    const userId = await customerWithWallet(100);
    const placed = await createOrder(userId, cart({ useWallet: true }));
    const id = idOf(placed);
    assert.equal(await walletOf(userId), 0);

    await cancelOrder(id, userId, 'changed my mind');
    const row = await orderRow(id);
    assert.equal(row.orderStatus, 'cancelled_by_user');
    assert.equal(await walletOf(userId), 100, 'wallet part back');
    assert.equal(row.refundLegs.length, 1);
    assert.equal(row.refundLegs[0].source, 'wallet');
    assert.equal(paise(row.refundLegs[0].amount), 10000, 'not the cash part: it was never collected');

    // Nothing more can come back from an admin "refund the rest" either: the
    // cash part was never collected, so there is nothing left on the order.
    await assert.rejects(() => processRefundAdmin(id, null, null), /Nothing is left to refund/);
    assert.equal(await walletOf(userId), 100, 'no second refund');
});

test('after delivery the cash part counts as paid; an admin can refund up to the total, never more', async () => {
    const userId = await customerWithWallet(100);
    const placed = await createOrder(userId, cart({ useWallet: true }));
    const id = idOf(placed);
    // Delivered and the rider collected the cash.
    await prisma.foodOrder.update({ where: { id }, data: { orderStatus: 'delivered', paymentStatus: 'paid' } });
    const row = await orderRow(id);
    const total = paise(row.total);
    assert.deepEqual(paidParts(row), { wallet: 10000, online: 0, cash: total - 10000 });

    await processRefundAdmin(id, null, null, 'wallet');
    const after = await orderRow(id);
    const refunded = after.refundLegs.filter((l) => l.status === 'processed').reduce((s, l) => s + paise(l.amount), 0);
    assert.equal(refunded, total, 'wallet part + collected cash = the total');
    assert.equal(paise(await walletOf(userId)), total, 'all of it as wallet credit');
    await assert.rejects(() => processRefundAdmin(id, 1, null, 'wallet'), /left to refund/);
});

test('the rider\'s cash in hand counts only the cash part', async () => {
    const userId = await customerWithWallet(100);
    const rider = await prisma.foodDeliveryPartner.create({ data: { name: `${tag} Rider`, phone: uniquePhone('8'), status: 'approved' } });
    created.riders.push(rider.id);
    const placed = await createOrder(userId, cart({ useWallet: true }));
    const id = idOf(placed);
    await prisma.foodOrder.update({
        where: { id },
        data: { orderStatus: 'delivered', paymentStatus: 'paid', dispatchDeliveryPartnerId: rider.id },
    });
    const total = paise((await orderRow(id)).total);

    const wallet = await getDeliveryPartnerWalletEnhanced(rider.id);
    assert.equal(paise(wallet.cashInHand), total - 10000);
});

test('a wallet emptied elsewhere before checkout leaves a plain cash order, not a failure', async () => {
    // (A balance that changes between planning and debiting is refused by the
    // ledger's overdraw guard, which has its own tests; the order is then removed.)
    const userId = await customerWithWallet(100);
    const before = await prisma.foodOrder.count({ where: { userId } });
    await recordTransaction({
        entityType: 'user', entityId: userId, type: 'debit', amount: 100,
        description: 'Spent in another tab', category: 'order_payment',
    });
    // With nothing left the planner finds no wallet part: a plain cash order.
    const placed = await createOrder(userId, cart({ useWallet: true }));
    const row = await orderRow(idOf(placed));
    assert.equal(paise(row.walletAmount), 0);
    assert.equal(await prisma.foodOrder.count({ where: { userId } }), before + 1);
});
