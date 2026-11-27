import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../utils/testIds.js';
import {
    MAX_RESTAURANT_DEVICES,
    logout,
    logoutAllRestaurantDevices,
    refreshAccessToken,
    requestRestaurantOtp,
    verifyRestaurantOtpAndLogin,
} from './auth.service.js';
import { authMiddleware } from './auth.middleware.js';
import { listOwnerTokens } from '../notifications/firebase.service.js';

/**
 * A restaurant runs on several phones at once -- the counter, the kitchen, the
 * owner -- and signing in on one must not sign the others out or take their
 * new-order alerts away.
 */
const created = { restaurants: [], phones: [] };
let restaurant;

test.before(async () => {
    const phone = uniquePhone('9');
    created.phones.push(phone);
    restaurant = await prisma.foodRestaurant.create({
        data: {
            restaurantName: `${uniqueTag('Multi')} Kitchen`,
            ownerName: 'Owner',
            ownerPhone: phone,
            status: 'approved',
            approvedAt: new Date(),
        },
    });
    created.restaurants.push(restaurant.id);
});

test.after(async () => {
    await prisma.foodRefreshToken.deleteMany({ where: { userId: { in: created.restaurants } } });
    await prisma.foodOtp.deleteMany({ where: { phone: { in: created.phones } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.$disconnect();
});

const otpFor = async (phone) => (await prisma.foodOtp.findUnique({ where: { phone } }))?.otp;

/** One phone signing in, with its own push token. */
const signIn = async (fcmToken) => {
    await requestRestaurantOtp(restaurant.ownerPhone);
    return verifyRestaurantOtpAndLogin(restaurant.ownerPhone, await otpFor(restaurant.ownerPhone), fcmToken, 'android');
};

/** Runs authMiddleware for a token: true when the request is let through. */
const passes = (accessToken) => new Promise((resolve) => {
    const res = {
        status() { return this; },
        json() { resolve(false); return this; },
    };
    authMiddleware({ headers: { authorization: `Bearer ${accessToken}` } }, res, () => resolve(true));
});

test('two phones stay signed in together, and both keep their push token', async () => {
    const kitchen = await signIn(`fcm-kitchen-${uniqueTag('t')}`);
    const counter = await signIn(`fcm-counter-${uniqueTag('t')}`);

    assert.equal(await passes(kitchen.accessToken), true, 'the first phone is not signed out');
    assert.equal(await passes(counter.accessToken), true);

    const tokens = await listOwnerTokens({ ownerType: 'RESTAURANT', ownerId: restaurant.id });
    assert.equal(tokens.length, 2, 'both phones ring for a new order');
});

test(`at most ${MAX_RESTAURANT_DEVICES} sessions; the oldest drops off`, async () => {
    const first = await signIn(`fcm-a-${uniqueTag('t')}`);
    for (let i = 0; i < MAX_RESTAURANT_DEVICES; i += 1) await signIn(`fcm-${i}-${uniqueTag('t')}`);

    const sessions = await prisma.foodRefreshToken.findMany({ where: { userId: restaurant.id } });
    assert.equal(sessions.length, MAX_RESTAURANT_DEVICES);
    assert.ok(!sessions.some((s) => s.token === first.refreshToken), 'the oldest session was dropped');

    const tokens = await listOwnerTokens({ ownerType: 'RESTAURANT', ownerId: restaurant.id });
    assert.equal(tokens.length, MAX_RESTAURANT_DEVICES, 'five phones ring, not three');
});

test('"Log out all devices" signs every phone out', async () => {
    const phoneA = await signIn(`fcm-x-${uniqueTag('t')}`);
    const phoneB = await signIn(`fcm-y-${uniqueTag('t')}`);

    await logoutAllRestaurantDevices(restaurant.id);

    assert.equal(await passes(phoneA.accessToken), false);
    assert.equal(await passes(phoneB.accessToken), false);
    assert.equal(await prisma.foodRefreshToken.count({ where: { userId: restaurant.id } }), 0);
    assert.deepEqual(await listOwnerTokens({ ownerType: 'RESTAURANT', ownerId: restaurant.id }), []);

    // And signing in again afterwards works.
    const again = await signIn(`fcm-z-${uniqueTag('t')}`);
    assert.equal(await passes(again.accessToken), true);
});

test('login response hides Aadhaar, PAN, bank account and push tokens', async () => {
    await prisma.foodRestaurant.update({
        where: { id: restaurant.id },
        data: { aadhaarNumber: '123412345678', panNumber: 'ABCDE1234F', accountNumber: '001122334455' },
    });
    const { user } = await signIn(`fcm-mask-${uniqueTag('t')}`);
    assert.equal(user.id, restaurant.id);
    assert.equal(user.aadhaarNumber, 'XXXXXXXX5678');
    assert.equal(user.panNumber, 'XXXXXX234F');
    assert.equal(user.accountNumber, 'XXXXXXXX4455');
    for (const key of ['fcmTokens', 'fcmTokenMobile', 'tokenVersion']) assert.ok(!(key in user), key);
});

test('logout ends the whole session: tokens it refreshed into stop working too', async () => {
    const login = await signIn(`fcm-out-${uniqueTag('t')}`);
    const other = await signIn(`fcm-keep-${uniqueTag('t')}`);
    const refreshed = await refreshAccessToken(login.refreshToken);

    await logout(refreshed.refreshToken);

    await assert.rejects(() => refreshAccessToken(login.refreshToken), /Invalid refresh token/);
    await assert.rejects(() => refreshAccessToken(refreshed.refreshToken), /Invalid refresh token/);
    assert.ok((await refreshAccessToken(other.refreshToken)).accessToken, 'another phone stays signed in');
});

test('a rider who logs out goes offline, ends the shift and drops the phone token', async () => {
    const { signRefreshToken } = await import('./token.util.js');
    const rider = await prisma.foodDeliveryPartner.create({
        data: { name: `${uniqueTag('Out')} Rider`, phone: uniquePhone('6'), status: 'approved', availabilityStatus: 'online', fcmTokenMobile: ['rider-tok'] },
    });
    await prisma.foodDeliveryPartnerSession.create({ data: { deliveryPartnerId: rider.id, wentOnlineAt: new Date(Date.now() - 600e3) } });
    try {
        const token = signRefreshToken({ userId: rider.id, role: 'DELIVERY_PARTNER' });
        await prisma.foodRefreshToken.create({ data: { userId: rider.id, token, expiresAt: new Date(Date.now() + 3600e3) } });
        await logout(token);
        const after = await prisma.foodDeliveryPartner.findUnique({ where: { id: rider.id } });
        assert.equal(after.availabilityStatus, 'offline');
        assert.deepEqual(after.fcmTokenMobile, []);
        const shift = await prisma.foodDeliveryPartnerSession.findFirst({ where: { deliveryPartnerId: rider.id } });
        assert.ok(shift.wentOfflineAt);
        assert.equal(shift.durationMinutes, 10);
    } finally {
        await prisma.foodDeliveryPartnerSession.deleteMany({ where: { deliveryPartnerId: rider.id } });
        await prisma.foodRefreshToken.deleteMany({ where: { userId: rider.id } });
        await prisma.foodDeliveryPartner.delete({ where: { id: rider.id } });
    }
});

test('a rejected restaurant loses API access and cannot refresh', async () => {
    const phone = await signIn(`fcm-rej-${uniqueTag('t')}`);
    await prisma.foodRestaurant.update({ where: { id: restaurant.id }, data: { status: 'rejected' } });
    try {
        assert.equal(await passes(phone.accessToken), false);
        await assert.rejects(() => refreshAccessToken(phone.refreshToken), /rejected/);
    } finally {
        await prisma.foodRestaurant.update({ where: { id: restaurant.id }, data: { status: 'approved' } });
    }
});
