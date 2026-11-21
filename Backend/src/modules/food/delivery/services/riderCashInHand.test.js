import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../../utils/testIds.js';
import { getRiderCashInHand, getDeliveryPartnerWalletEnhanced } from './deliveryFinance.service.js';
import { getDeliveryPartnerWallet } from './delivery.service.js';

/**
 * Cash in hand is the COD cash a rider collected and has not deposited (plus
 * change kept for customers on approved change-to-wallet), never a sum of
 * their earnings. The pocket wallet and the full wallet must agree.
 * Seeding follows orders/services/opsChangeWallet.test.js.
 */
const created = { restaurants: [], users: [], riders: [], orders: [], deposits: [] };
let tag;
let restaurantId;
let userId;

const newOrder = async (riderId, data = {}) => {
    const o = await prisma.foodOrder.create({
        data: {
            order_id: `T-${uniqueTag('O')}`.slice(0, 30),
            restaurantId, userId,
            dispatchDeliveryPartnerId: riderId,
            addrStreet: '1 Test Street', addrCity: 'Indore', addrState: 'MP',
            subtotal: 300, total: 300, paymentMethod: 'cash', paymentStatus: 'paid',
            orderStatus: 'delivered', riderEarning: 40,
            ...data,
        },
    });
    created.orders.push(o.id);
    return o;
};

test.before(async () => {
    tag = uniqueTag('CIH');
    const restaurant = await prisma.foodRestaurant.create({
        data: { restaurantName: `${tag} Kitchen`, ownerName: 'Owner', ownerPhone: uniquePhone('9'), status: 'approved' },
    });
    created.restaurants.push(restaurant.id);
    restaurantId = restaurant.id;
    const u = await prisma.foodUser.create({ data: { name: `${tag} Customer`, phone: uniquePhone('5') } });
    created.users.push(u.id);
    userId = u.id;
});

test.after(async () => {
    const ids = created.orders;
    await prisma.foodChangeCredit.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.foodDeliveryCashDeposit.deleteMany({ where: { id: { in: created.deposits } } });
    await prisma.wallet.deleteMany({ where: { entityId: { in: created.riders } } });
    await prisma.foodOrder.deleteMany({ where: { id: { in: ids } } });
    await prisma.foodDeliveryPartner.deleteMany({ where: { id: { in: created.riders } } });
    await prisma.foodUser.deleteMany({ where: { id: { in: created.users } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.$disconnect();
});

test('pocket cashInHand = COD collected + change kept - deposits, same as the wallet', async () => {
    const rider = await prisma.foodDeliveryPartner.create({
        data: { name: `${tag} Rider`, phone: uniquePhone('8'), status: 'approved' },
    });
    created.riders.push(rider.id);

    // 300 cash; 400 with 100 paid from the wallet (only 300 in hand);
    // an online order (no cash); an undelivered cash order (not collected yet).
    const a = await newOrder(rider.id);
    await newOrder(rider.id, { total: 400, walletAmount: 100 });
    await newOrder(rider.id, { paymentMethod: 'razorpay', total: 500 });
    await newOrder(rider.id, { orderStatus: 'picked_up', total: 250 });

    // The rider kept 20 change for a customer (approved): cash they hold too.
    await prisma.foodChangeCredit.create({
        data: {
            orderId: a.id, deliveryPartnerId: rider.id, userId,
            amount: 20, cashCollected: 320, orderCashDue: 300, status: 'approved', reviewedAt: new Date(),
        },
    });
    // Deposited 150; a pending deposit does not count.
    for (const [amount, status] of [[150, 'Completed'], [80, 'Pending']]) {
        const d = await prisma.foodDeliveryCashDeposit.create({
            data: { deliveryPartnerId: rider.id, amount, status },
        });
        created.deposits.push(d.id);
    }

    const cash = await getRiderCashInHand(rider.id);
    assert.equal(cash.collected, 620, '300 + 300 + 20 change');
    assert.equal(cash.deposited, 150);
    assert.equal(cash.changeKeptForCustomers, 20);
    assert.equal(cash.cashInHand, 470);

    const pocket = await getDeliveryPartnerWallet(rider.id);
    assert.equal(pocket.cashInHand, 470, 'not the 120 of rider earnings on cash orders');
    assert.equal(pocket.changeKeptForCustomers, 20);

    const wallet = await getDeliveryPartnerWalletEnhanced(rider.id);
    assert.equal(wallet.cashInHand, pocket.cashInHand, 'pocket and wallet agree');
    assert.equal(wallet.changeKeptForCustomers, 20);
    assert.equal(pocket.availableCashLimit, wallet.availableCashLimit);
});

test('a rider with no cash orders has nothing in hand', async () => {
    const rider = await prisma.foodDeliveryPartner.create({
        data: { name: `${tag} Online Rider`, phone: uniquePhone('8'), status: 'approved' },
    });
    created.riders.push(rider.id);
    await newOrder(rider.id, { paymentMethod: 'razorpay' });
    assert.equal((await getRiderCashInHand(rider.id)).cashInHand, 0);
    assert.equal((await getDeliveryPartnerWallet(rider.id)).cashInHand, 0);
});
