import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../../utils/testIds.js';
import { createWithdrawalRequest } from './restaurantWithdrawal.service.js';
import { getRestaurantFinance } from './restaurantFinance.service.js';

/** Two withdrawal requests at once used to both pass the balance check. */
const created = { restaurantId: null, userId: null, orderId: null };

test.before(async () => {
    const r = await prisma.foodRestaurant.create({
        data: { restaurantName: `${uniqueTag('Wd')} Kitchen`, ownerName: 'O', ownerPhone: uniquePhone('9'), status: 'approved' },
    });
    created.restaurantId = r.id;
    const u = await prisma.foodUser.create({ data: { phone: uniquePhone('5') } });
    created.userId = u.id;
    const o = await prisma.foodOrder.create({
        data: {
            userId: u.id, restaurantId: r.id, orderId: uniqueTag('ORD'), orderStatus: 'delivered',
            paymentMethod: 'cash', addrStreet: '1 Test Street', addrCity: 'Indore', addrState: 'MP',
            subtotal: 1000, packagingFee: 0, restaurantCommission: 0, total: 1000,
        },
    });
    created.orderId = o.id;
});

test.after(async () => {
    await prisma.foodRestaurantWithdrawal.deleteMany({ where: { restaurantId: created.restaurantId } });
    await prisma.foodTransaction.deleteMany({ where: { orderId: created.orderId } });
    await prisma.foodOrder.deleteMany({ where: { id: created.orderId } });
    await prisma.foodUser.deleteMany({ where: { id: created.userId } });
    await prisma.foodRestaurant.deleteMany({ where: { id: created.restaurantId } });
    await prisma.$disconnect();
});

test('two concurrent withdrawals cannot spend the same balance', async () => {
    const available = (await getRestaurantFinance(created.restaurantId)).wallet.netAvailable;
    assert.ok(available > 0, `balance ${available}`);
    const amount = Math.floor(available * 0.8);

    const results = await Promise.allSettled([
        createWithdrawalRequest(created.restaurantId, { amount }),
        createWithdrawalRequest(created.restaurantId, { amount }),
        createWithdrawalRequest(created.restaurantId, { amount }),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.match(String(results.find((r) => r.status === 'rejected').reason?.message), /Insufficient|restricted/);
    assert.equal(await prisma.foodRestaurantWithdrawal.count({ where: { restaurantId: created.restaurantId } }), 1);
});
