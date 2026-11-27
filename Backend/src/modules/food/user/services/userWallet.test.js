import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone } from '../../../../utils/testIds.js';
import { isRazorpayConfigured } from '../../orders/helpers/razorpay.helper.js';
import { createWalletTopupOrder, getUserWallet, verifyWalletTopupPayment } from './userWallet.service.js';

let user;
test.before(async () => {
    user = await prisma.foodUser.create({ data: { phone: uniquePhone('7') } });
});
test.after(async () => {
    await prisma.foodUser.delete({ where: { id: user.id } }).catch(() => {});
});

test('a top-up below ₹1 is refused before any gateway order is made', async () => {
    for (const amount of [0.001, 0.5, 0, -5, 'abc']) {
        await assert.rejects(() => createWalletTopupOrder(user.id, amount), /Minimum top-up amount is ₹1/);
    }
});

test('without Razorpay keys a top-up is never credited on the caller\'s word', { skip: isRazorpayConfigured() }, async () => {
    await assert.rejects(() => createWalletTopupOrder(user.id, 100), /not available/);
    await assert.rejects(
        () => verifyWalletTopupPayment(user.id, {
            razorpayOrderId: 'order_dev_1', razorpayPaymentId: 'pay_x', razorpaySignature: 'sig', amount: 50000,
        }),
        /not available/,
    );
    const wallet = await getUserWallet(user.id);
    assert.equal(Number(wallet?.balance ?? 0), 0);
});
