import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';

import { config } from '../../config/env.js';
import { __setThirdPartyForTests, thirdPartyService } from './adminCredentials.js';
import {
    isRazorpayConfigured, getRazorpayKeyId, getRazorpayKeySource, verifyPaymentSignature, getAdminRazorpayWebhookSecret,
} from '../../modules/food/orders/helpers/razorpay.helper.js';
import { resolveSmsProvider } from '../otp/otp.service.js';

/**
 * Keys saved under admin → 3rd Party are used only when the server's own
 * environment has none, and only once the service is switched on. Nothing here
 * talks to Razorpay or an SMS service.
 */
const envRazorpay = Boolean(config.razorpayKeyId && config.razorpayKeySecret);
const envSms = Boolean(config.smsApiKey && config.smsSenderId);

test.after(() => __setThirdPartyForTests({}));

test('a service is only used once it is switched on', () => {
    __setThirdPartyForTests({ razorpay: { enabled: false, keyId: 'rzp_test_x', keySecret: 's' } });
    assert.equal(thirdPartyService('razorpay'), null);
    __setThirdPartyForTests({ razorpay: { enabled: true, keyId: 'rzp_test_x', keySecret: 's' } });
    assert.equal(thirdPartyService('razorpay').keyId, 'rzp_test_x');
});

test('Razorpay: the panel keys are used when the server has none', { skip: envRazorpay && 'the server has env keys' }, () => {
    __setThirdPartyForTests({});
    assert.equal(isRazorpayConfigured(), false);
    assert.equal(getRazorpayKeySource(), 'none');

    __setThirdPartyForTests({ razorpay: { enabled: true, keyId: 'rzp_test_panel123', keySecret: 'panel-secret', webhookSecret: 'hook' } });
    assert.equal(getRazorpayKeySource(), 'admin');
    assert.equal(getRazorpayKeyId(), 'rzp_test_panel123');
    assert.equal(getAdminRazorpayWebhookSecret(), 'hook');
    // Payments are signed with the panel's secret.
    const sig = crypto.createHmac('sha256', 'panel-secret').update('order_1|pay_1').digest('hex');
    assert.equal(verifyPaymentSignature('order_1', 'pay_1', sig), true);
    assert.equal(verifyPaymentSignature('order_1', 'pay_1', 'forged'), false);

    // Template placeholders are not keys.
    __setThirdPartyForTests({ razorpay: { enabled: true, keyId: 'your_key_id', keySecret: 'your_key_secret' } });
    assert.equal(isRazorpayConfigured(), false);
});

test('SMS: SMS India Hub from the panel first, then Twilio, else nothing', { skip: envSms && 'the server has env SMS keys' }, () => {
    __setThirdPartyForTests({});
    assert.equal(resolveSmsProvider(), null);

    __setThirdPartyForTests({ twilio: { enabled: true, accountSid: 'AC1', authToken: 't', phoneNumber: '+15550001111' } });
    const twilio = resolveSmsProvider();
    assert.equal(twilio.name, 'twilio');
    assert.match(twilio.template, /\{otp\}/);

    __setThirdPartyForTests({
        twilio: { enabled: true, accountSid: 'AC1', authToken: 't', phoneNumber: '+15550001111' },
        sms_india_hub: { enabled: true, apiKey: 'k', senderId: 'QSPICY', dltTemplateId: '123', messageTemplate: 'Your Quick Spicy OTP is {otp}' },
    });
    const hub = resolveSmsProvider();
    assert.equal(hub.name, 'sms_india_hub');
    assert.equal(hub.senderId, 'QSPICY');
    assert.equal(hub.template, 'Your Quick Spicy OTP is {otp}');
});
