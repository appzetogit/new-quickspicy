import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

import { config } from '../../config/env.js';
import { handleRazorpayWebhook } from './controllers/razorpayWebhook.controller.js';

const call = async (headers, body) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, send() { return this; }, json() { return this; } };
    const rawBody = Buffer.from(JSON.stringify(body));
    await handleRazorpayWebhook({ headers, body, rawBody }, res);
    return res.code;
};

test('the Razorpay webhook refuses a missing or forged signature', async () => {
    const saved = config.razorpayWebhookSecret;
    config.razorpayWebhookSecret = 'whsec_test';
    try {
        const body = { event: 'payment.captured', payload: {} };
        assert.equal(await call({}, body), 400);
        const forged = crypto.createHmac('sha256', 'wrong').update(JSON.stringify(body)).digest('hex');
        assert.equal(await call({ 'x-razorpay-signature': forged }, body), 400);
        const genuine = crypto.createHmac('sha256', 'whsec_test').update(JSON.stringify(body)).digest('hex');
        assert.notEqual(await call({ 'x-razorpay-signature': genuine }, body), 400);
    } finally {
        config.razorpayWebhookSecret = saved;
    }
});
