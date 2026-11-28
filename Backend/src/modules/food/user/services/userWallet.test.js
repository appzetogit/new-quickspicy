import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone } from '../../../../utils/testIds.js';
import crypto from 'crypto';
import { isRazorpayConfigured, __setRazorpayForTests } from '../../orders/helpers/razorpay.helper.js';
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

test('with Razorpay set up, a top-up order is created and the verified payment is credited once', async () => {
    const fake = {
        orders: { create: async ({ amount, currency }) => ({ id: `order_wt_${user.id.slice(-6)}`, amount, currency }) },
        payments: { fetch: async (id) => ({ id, order_id: `order_wt_${user.id.slice(-6)}`, status: 'captured', amount: 25000 }) },
    };
    __setRazorpayForTests(fake, { keySecret: 'wallet_topup_secret' });
    try {
        const before = Number((await getUserWallet(user.id))?.balance ?? 0);
        const { razorpay } = await createWalletTopupOrder(user.id, 250);
        assert.equal(razorpay.amount, 25000);
        const sig = crypto.createHmac('sha256', 'wallet_topup_secret').update(`${razorpay.orderId}|pay_wt1`).digest('hex');
        const payload = { razorpayOrderId: razorpay.orderId, razorpayPaymentId: 'pay_wt1', razorpaySignature: sig, amount: 250 };
        await verifyWalletTopupPayment(user.id, payload);
        await verifyWalletTopupPayment(user.id, payload).catch(() => {}); // a retried callback
        assert.equal(Number((await getUserWallet(user.id)).balance), before + 250);
        await assert.rejects(() => verifyWalletTopupPayment(user.id, { ...payload, razorpaySignature: 'bad' }), /verification failed/);
        // A gateway refusal (bad keys) is a clear 400, not Razorpay's own 401/500.
        fake.orders.create = async () => { throw Object.assign(new Error('auth'), { statusCode: 401 }); };
        const err = await createWalletTopupOrder(user.id, 100).catch((e) => e);
        assert.equal(err.statusCode ?? err.status, 400);
        assert.match(err.message, /Could not start the payment/);
    } finally {
        __setRazorpayForTests(null);
        await prisma.transaction.deleteMany({ where: { entityType: 'user', entityId: user.id } }).catch(() => {});
    }
});
