import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../../utils/testIds.js';
import { istDateKey } from '../../../../utils/timezone.js';
import { requestRestaurantOtp, verifyRestaurantOtpAndLogin } from '../../../../core/auth/auth.service.js';
import { validateRestaurantOtpRequestDto } from '../../../../dtos/auth/restaurantOtpRequest.dto.js';
import { validateRestaurantOtpVerifyDto } from '../../../../dtos/auth/restaurantOtpVerify.dto.js';
import { validateRestaurantRegisterDto } from '../validators/restaurant.validator.js';
import { registerRestaurant, updateRestaurantProfile } from './restaurant.service.js';

/**
 * Restaurant sign-up: only a number that passed OTP can register, and the
 * KYC fields are checked on the way in.
 */
const created = { restaurants: [], phones: [] };

test.after(async () => {
    await prisma.foodRestaurantOutletTimings.deleteMany({ where: { restaurantId: { in: created.restaurants } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.foodOtp.deleteMany({ where: { phone: { in: created.phones } } });
    await prisma.$disconnect();
});

const form = (phone, extra = {}) => ({
    restaurantName: `${uniqueTag('Signup')} Kitchen`,
    ownerName: 'Owner',
    ownerPhone: phone,
    pureVegRestaurant: 'true',
    ...extra,
});

const tomorrow = () => istDateKey(new Date(Date.now() + 864e5));
const yesterday = () => istDateKey(new Date(Date.now() - 864e5));

test('register refuses a phone that has not passed OTP', async () => {
    const phone = uniquePhone('9');
    created.phones.push(phone);
    await assert.rejects(() => registerRestaurant(validateRestaurantRegisterDto(form(phone))), /verify your phone/);
});

test('after OTP the number registers once; the proof is then spent', async () => {
    const phone = uniquePhone('9');
    created.phones.push(phone);
    await requestRestaurantOtp(phone);
    const { otp } = await prisma.foodOtp.findUnique({ where: { phone } });
    const result = await verifyRestaurantOtpAndLogin(phone, otp);
    assert.equal(result.needsRegistration, true);

    const restaurant = await registerRestaurant(validateRestaurantRegisterDto(form(phone)));
    created.restaurants.push(restaurant.id || restaurant._id);
    assert.ok(restaurant);

    await assert.rejects(
        () => registerRestaurant(validateRestaurantRegisterDto(form(phone))),
        /verify your phone/,
    );
});

test('registration KYC fields are validated', () => {
    const phone = '9876543210';
    const bad = [
        [{ fssaiExpiry: yesterday() }, /today or a later date/],
        [{ fssaiExpiry: 'not-a-date' }, /invalid/],
        [{ ifscCode: 'SBIN1234' }, /IFSC/],
        [{ accountNumber: '12ab' }, /Account number/],
        [{ gstRegistered: 'true', gstNumber: 'GST123' }, /GSTIN/],
        [{ openingTime: '25:99' }, /not a valid time/],
        [{ onboardingFeeAmount: '-5' }, /negative/],
        [{ subscriptionAmount: '-1' }, /negative/],
    ];
    for (const [extra, message] of bad) {
        assert.throws(() => validateRestaurantRegisterDto(form(phone, extra)), message, JSON.stringify(extra));
    }
    // The valid forms, and blanks, still pass.
    assert.ok(validateRestaurantRegisterDto(form(phone, {
        fssaiExpiry: istDateKey(), ifscCode: 'SBIN0001234', accountNumber: '123456789012',
        gstRegistered: 'true', gstNumber: '22ABCDE1234F1Z5', openingTime: '09:00', closingTime: '22:00',
    })));
    assert.ok(validateRestaurantRegisterDto(form(phone, { fssaiExpiry: '', ifscCode: '', gstNumber: '' })));
});

test('OTP request needs a 10-digit mobile; OTP verify needs 4 digits', () => {
    assert.throws(() => validateRestaurantOtpRequestDto({ phone: '12345678' }), /10-digit/);
    assert.equal(validateRestaurantOtpRequestDto({ phone: '919876543210' }).phone, '9876543210');
    assert.throws(() => validateRestaurantOtpVerifyDto({ phone: '9876543210', otp: '12a4' }), /4 digits/);
    assert.throws(() => validateRestaurantOtpVerifyDto({ phone: '9876543210', otp: '123456' }), /4 digits/);
});

test('profile edit rejects a bad PAN, GSTIN, past FSSAI expiry or invalid time', async () => {
    const restaurant = await prisma.foodRestaurant.create({
        data: { restaurantName: `${uniqueTag('Kyc')} Kitchen`, ownerName: 'Owner', ownerPhone: uniquePhone('9'), status: 'pending' },
    });
    created.restaurants.push(restaurant.id);
    await assert.rejects(() => updateRestaurantProfile(restaurant.id, { panNumber: 'ABC123' }), /PAN/);
    await assert.rejects(() => updateRestaurantProfile(restaurant.id, { gstNumber: 'X1' }), /GSTIN/);
    await assert.rejects(() => updateRestaurantProfile(restaurant.id, { fssaiExpiry: yesterday() }), /today or a later/);
    await assert.rejects(() => updateRestaurantProfile(restaurant.id, { openingTime: '25:99' }), /not a valid time/);

    await updateRestaurantProfile(restaurant.id, { panNumber: 'abcde1234f', fssaiExpiry: tomorrow() });
    const after = await prisma.foodRestaurant.findUnique({ where: { id: restaurant.id } });
    assert.equal(after.panNumber, 'ABCDE1234F');
    assert.equal(istDateKey(after.fssaiExpiry), tomorrow());
});
