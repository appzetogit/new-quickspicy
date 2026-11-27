import test from 'node:test';
import assert from 'node:assert/strict';

import { validateDeliveryOtpRequestDto } from './deliveryOtpRequest.dto.js';
import { validateDeliveryOtpVerifyDto } from './deliveryOtpVerify.dto.js';

test('rider OTP phone is one spelling; letters and non-4-digit codes are refused', () => {
    assert.equal(validateDeliveryOtpRequestDto({ phone: '+91 98765 43210' }).phone, '9876543210');
    assert.equal(validateDeliveryOtpRequestDto({ phone: '9876543210' }).phone, '9876543210');
    assert.throws(() => validateDeliveryOtpRequestDto({ phone: '98765abcde' }), /10-digit/);
    assert.equal(validateDeliveryOtpVerifyDto({ phone: '919876543210', otp: '1234' }).phone, '9876543210');
    for (const otp of ['12a4', '123', '123456']) {
        assert.throws(() => validateDeliveryOtpVerifyDto({ phone: '9876543210', otp }), /4 digits/);
    }
});
