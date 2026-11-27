import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../../utils/testIds.js';
import {
    acceptOrderDelivery,
    confirmPickupDelivery,
    confirmReachedPickupDelivery,
    confirmReachedDropDelivery,
    verifyDropOtpDelivery,
    getOrderRouteForUser,
    MAX_DROP_OTP_ATTEMPTS,
} from '../../orders/services/order-delivery.service.js';
import { sanitizeOrderForDeliveryPartner } from '../../orders/services/order.helpers.js';
import { calculateRiderEarning } from '../../orders/services/order-pricing.service.js';
import {
    registerDeliveryPartner,
    signRiderRegistrationToken,
    updateDeliveryAvailability,
    getDeliveryPartnerTripHistory,
    getDeliveryPartnerEarnings,
} from './delivery.service.js';
import {
    normalizeRiderPhone,
    validateDeliveryRegisterDto,
    validateDeliveryBankDetailsDto,
    validateRiderSelfRegisterDto,
} from '../validators/delivery.validator.js';

/**
 * The rider side of a trip, through the real service functions: who may run a
 * trip, in what order, the drop OTP lock, the cash limit, availability pings,
 * trip history dates, registration and what the rider/customer may see.
 */
const created = { restaurants: [], users: [], riders: [], orders: [], limits: [] };
let tag;
let restaurantId;
let userId;

const newRider = async (data = {}) => {
    const r = await prisma.foodDeliveryPartner.create({
        data: { name: `${tag} Rider`, phone: uniquePhone('8'), status: 'approved', ...data },
    });
    created.riders.push(r.id);
    return r;
};

const newOrder = async (data = {}) => {
    const o = await prisma.foodOrder.create({
        data: {
            order_id: `T-${uniqueTag('O')}`.slice(0, 30),
            restaurantId, userId,
            addrStreet: '1 Test Street', addrCity: 'Indore', addrState: 'MP',
            addrLat: 22.72, addrLng: 75.86,
            subtotal: 300, total: 300, paymentMethod: 'razorpay', paymentStatus: 'paid',
            orderStatus: 'preparing',
            ...data,
        },
    });
    created.orders.push(o.id);
    return o;
};

test.before(async () => {
    tag = uniqueTag('Trip');
    const restaurant = await prisma.foodRestaurant.create({
        data: {
            restaurantName: `${tag} Kitchen`, ownerName: 'Owner', ownerPhone: uniquePhone('9'),
            status: 'approved', latitude: 22.7196, longitude: 75.8577,
        },
    });
    created.restaurants.push(restaurant.id);
    restaurantId = restaurant.id;
    const u = await prisma.foodUser.create({
        data: { name: `${tag} Customer`, phone: uniquePhone('5'), email: `${tag}@example.com` },
    });
    created.users.push(u.id);
    userId = u.id;
});

test.after(async () => {
    const ids = created.orders;
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.foodTransaction.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.foodOrder.deleteMany({ where: { id: { in: ids } } });
    await prisma.foodDeliveryCashLimit.deleteMany({ where: { id: { in: created.limits } } });
    await prisma.foodDeliveryPartnerSession.deleteMany({ where: { deliveryPartnerId: { in: created.riders } } });
    await prisma.foodDeliveryPartner.deleteMany({ where: { id: { in: created.riders } } });
    await prisma.foodUser.deleteMany({ where: { id: { in: created.users } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.$disconnect();
});

test('a rider only offered an order cannot run the trip', async () => {
    const rider = await newRider();
    const order = await newOrder({ dispatchStatus: 'assigned', dispatchDeliveryPartnerId: rider.id });
    await assert.rejects(confirmPickupDelivery(order.id, rider.id), /Accept this order/);
    await assert.rejects(confirmReachedPickupDelivery(order.id, rider.id), /Accept this order/);
    await assert.rejects(verifyDropOtpDelivery(order.id, rider.id, '1234'), /Accept this order/);
});

test('reached drop needs a pickup first; cancelled orders take no trip steps', async () => {
    const rider = await newRider();
    const live = await newOrder({ dispatchStatus: 'accepted', dispatchDeliveryPartnerId: rider.id, dispatchAcceptedAt: new Date() });
    await assert.rejects(confirmReachedDropDelivery(live.id, rider.id), /Confirm pickup before/);

    const cancelled = await newOrder({
        orderStatus: 'cancelled_by_user', dispatchStatus: 'accepted', dispatchDeliveryPartnerId: rider.id,
        dispatchAcceptedAt: new Date(), pickedUpAt: new Date(), deliveryOtp: '4321', dropOtpRequired: true,
    });
    await assert.rejects(confirmReachedPickupDelivery(cancelled.id, rider.id), /cancelled/);
    await assert.rejects(confirmReachedDropDelivery(cancelled.id, rider.id), /cancelled/);
    await assert.rejects(verifyDropOtpDelivery(cancelled.id, rider.id, '4321'), /cancelled/);
});

test(`the drop OTP locks after ${MAX_DROP_OTP_ATTEMPTS} wrong tries`, async () => {
    const rider = await newRider();
    const order = await newOrder({
        orderStatus: 'picked_up', dispatchStatus: 'accepted', dispatchDeliveryPartnerId: rider.id,
        dispatchAcceptedAt: new Date(), pickedUpAt: new Date(), deliveryOtp: '4321', dropOtpRequired: true,
    });
    for (let i = 1; i < MAX_DROP_OTP_ATTEMPTS; i += 1) {
        await assert.rejects(verifyDropOtpDelivery(order.id, rider.id, '0000'), /attempts? left/);
    }
    await assert.rejects(verifyDropOtpDelivery(order.id, rider.id, '0000'), /contact support/);
    // Locked: even the right code is refused now.
    await assert.rejects(verifyDropOtpDelivery(order.id, rider.id, '4321'), /contact support/);
});

test('the right drop OTP still verifies', async () => {
    const rider = await newRider();
    const order = await newOrder({
        orderStatus: 'picked_up', dispatchStatus: 'accepted', dispatchDeliveryPartnerId: rider.id,
        dispatchAcceptedAt: new Date(), pickedUpAt: new Date(), deliveryOtp: '4321', dropOtpRequired: true,
    });
    await assert.rejects(verifyDropOtpDelivery(order.id, rider.id, '1111'), /Invalid OTP/);
    const { order: out } = await verifyDropOtpDelivery(order.id, rider.id, '4321');
    assert.equal(out.deliveryVerification.dropOtp.verified, true);
});

test('COD cash collected counts against the cash limit', async () => {
    const before = await prisma.foodDeliveryCashLimit.findMany({ where: { isActive: true } });
    await prisma.foodDeliveryCashLimit.updateMany({ where: { isActive: true }, data: { isActive: false } });
    try {
        const limit = await prisma.foodDeliveryCashLimit.create({ data: { deliveryCashLimit: 500, isActive: true } });
        created.limits.push(limit.id);
        const rider = await newRider();
        // Delivered COD: 600 in hand, nothing deposited.
        await newOrder({
            orderStatus: 'delivered', paymentMethod: 'cash', total: 600, subtotal: 600,
            dispatchStatus: 'accepted', dispatchDeliveryPartnerId: rider.id, deliveredAt: new Date(),
        });
        const offered = await newOrder({ paymentMethod: 'cash', dispatchStatus: 'assigned', dispatchDeliveryPartnerId: rider.id });
        await assert.rejects(acceptOrderDelivery(offered.id, rider.id), /at your Rs.500 limit/);

        const { getCashBlockedPartnerIds } = await import('../../orders/services/order-dispatch.service.js');
        assert.ok((await getCashBlockedPartnerIds([rider.id])).has(rider.id));
    } finally {
        await prisma.foodDeliveryCashLimit.updateMany({
            where: { id: { in: before.map((b) => b.id) } }, data: { isActive: true },
        });
    }
});

test('a location ping without a status keeps the rider online and ignores 0,0', async () => {
    const rider = await newRider({ availabilityStatus: 'online', lastLat: 22.7, lastLng: 75.8 });
    const out = await updateDeliveryAvailability(rider.id, { lat: null, lng: null });
    assert.equal(out.availabilityStatus, 'online');
    await updateDeliveryAvailability(rider.id, { lat: 0, lng: 0 });
    const after = await prisma.foodDeliveryPartner.findUnique({ where: { id: rider.id } });
    assert.equal(after.availabilityStatus, 'online');
    assert.equal(after.lastLat, 22.7);
    assert.equal(after.lastLng, 75.8);
});

test('trip history: a bad date is a 400 and an old trip touched today stays on its own day', async () => {
    const rider = await newRider();
    await assert.rejects(getDeliveryPartnerTripHistory(rider.id, { date: 'not-a-date' }), { statusCode: 400 });
    await assert.rejects(getDeliveryPartnerEarnings(rider.id, { date: '2026-13-45' }), { statusCode: 400 });

    const lastWeek = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    const old = await newOrder({
        orderStatus: 'delivered', dispatchStatus: 'accepted', dispatchDeliveryPartnerId: rider.id,
        createdAt: lastWeek, deliveredAt: lastWeek,
    });
    // Rated today: updatedAt moves to now.
    await prisma.foodOrder.update({ where: { id: old.id }, data: { customerRating: 5 } });
    const today = await getDeliveryPartnerTripHistory(rider.id, { period: 'daily' });
    assert.equal(today.trips.some((t) => t.id === old.id), false);
    const thatDay = await getDeliveryPartnerTripHistory(rider.id, { period: 'daily', date: lastWeek.toISOString() });
    assert.equal(thatDay.trips.some((t) => t.id === old.id), true);
});

test('the customer sees no rider position before accept or after delivery', async () => {
    const rider = await newRider({ lastLat: 22.73, lastLng: 75.87, lastLocationAt: new Date() });
    const offered = await newOrder({ dispatchStatus: 'assigned', dispatchDeliveryPartnerId: rider.id, riderLat: 22.73, riderLng: 75.87 });
    assert.equal((await getOrderRouteForUser(offered.id, userId)).origin, null);
    const done = await newOrder({
        orderStatus: 'delivered', dispatchStatus: 'accepted', dispatchDeliveryPartnerId: rider.id,
        riderLat: 22.73, riderLng: 75.87, deliveredAt: new Date(),
    });
    assert.equal((await getOrderRouteForUser(done.id, userId)).origin, null);
    const live = await newOrder({
        dispatchStatus: 'accepted', dispatchDeliveryPartnerId: rider.id, dispatchAcceptedAt: new Date(),
        riderLat: 22.73, riderLng: 75.87,
    });
    const route = await getOrderRouteForUser(live.id, userId);
    assert.deepEqual(route.origin, { lat: 22.73, lng: 75.87 });
    assert.ok(route.durationMins > 1, 'no Google route: distance estimate, not 1 minute');
});

test('the rider payload carries no customer email or platform margins', () => {
    const out = sanitizeOrderForDeliveryPartner({
        _id: 'x', userId: { id: 'u', name: 'A', phone: '9', email: 'a@b.c' },
        platformProfit: 40, priceMarkupAmount: 12,
        amounts: { riderShare: 30, platformNetProfit: 40, priceMarkupAmount: 12 },
        items: [{ name: 'Dish', price: 110, basePrice: 100, markupPercent: 10 }],
    });
    assert.equal(out.userId.email, undefined);
    assert.equal(out.userId.phone, '9');
    assert.equal(out.platformProfit, undefined);
    assert.equal(out.priceMarkupAmount, undefined);
    assert.deepEqual(out.amounts, { riderShare: 30 });
    assert.deepEqual(out.items, [{ name: 'Dish', price: 110 }]);
});

test('minimum rider pay applies when the distance is unknown', () => {
    const settings = { riderMinPayPerTrip: 25, deliveryFeeRanges: [{ min: 0, max: 5, deliveryBoyBasePay: 10, deliveryBoyPerKm: 0 }] };
    assert.equal(calculateRiderEarning(settings, null), 25);
    assert.equal(calculateRiderEarning(settings, undefined), 25);
    assert.equal(calculateRiderEarning(settings, 2), 25);
});

test('rider phone, name, OTP and bank details are validated', () => {
    assert.equal(normalizeRiderPhone('+91 98765 43210'), '9876543210');
    assert.equal(normalizeRiderPhone('09876543210'), '9876543210');
    assert.equal(normalizeRiderPhone('919876543210'), '9876543210');
    assert.equal(normalizeRiderPhone('abcdefghij'), null);
    assert.equal(normalizeRiderPhone('12345'), null);
    assert.throws(() => validateDeliveryRegisterDto({ name: '   ', phone: '9876543210' }), /Name is required/);
    assert.throws(() => validateDeliveryRegisterDto({ name: 'Ravi', phone: 'abcdefghij' }), /10-digit/);
    assert.equal(validateDeliveryRegisterDto({ name: ' Ravi ', phone: '+919876543210' }).phone, '9876543210');

    assert.equal(validateDeliveryRegisterDto({ name: 'Ravi', phone: '9876543210', vehicleNumber: 'mh 12 ab 1234' }).vehicleNumber, 'MH12AB1234');
    assert.equal(validateDeliveryRegisterDto({ name: 'Ravi', phone: '9876543210', vehicleNumber: '22BH1234AB' }).vehicleNumber, '22BH1234AB');
    assert.throws(() => validateRiderSelfRegisterDto({ name: 'Ravi', phone: '9876543210', vehicleNumber: 'ABC' }), /vehicle number/);
    assert.throws(() => validateDeliveryRegisterDto({ name: 'Ravi', phone: '9876543210', bankIfscCode: 'XYZ' }), /IFSC/);
    assert.throws(() => validateDeliveryRegisterDto({ name: 'Ravi', phone: '5876543210' }), /10-digit/);

    const bank = (b) => validateDeliveryBankDetailsDto({ documents: { bankDetails: b } });
    assert.throws(() => bank({ accountNumber: 'abc' }), /9 to 18 digits/);
    assert.throws(() => bank({ ifscCode: 'XYZ' }), /IFSC/);
    assert.equal(bank({ accountNumber: ' 123456789 ', ifscCode: 'sbin0001234' }).documents.bankDetails.ifscCode, 'SBIN0001234');
    assert.equal(bank({ accountNumber: '' }).documents.bankDetails.accountNumber, '');
});

test('sign-up needs a verified phone and +91 cannot open a second account', async () => {
    const phone = uniquePhone('7');
    const dto = (extra = {}) => validateDeliveryRegisterDto({ name: `${tag} New`, phone, ...extra });

    await assert.rejects(registerDeliveryPartner(dto(), {}, { phone }), /Verify your phone/);
    await assert.rejects(registerDeliveryPartner(dto({ registrationToken: 'forged' }), {}, { phone }), /expired/);
    // A token for another number does not carry over.
    await assert.rejects(
        registerDeliveryPartner(dto({ registrationToken: signRiderRegistrationToken(uniquePhone('7')) }), {}, { phone }),
        /expired/,
    );

    const partner = await registerDeliveryPartner(dto({
        registrationToken: signRiderRegistrationToken(phone), bankAccountNumber: '123456789012', bankIfscCode: 'sbin0001234',
    }), {}, { phone });
    created.riders.push(partner.id);
    assert.equal(partner.phone, phone);
    assert.equal(partner.bankAccountNumber, '123456789012', 'bank step saved on self sign-up');
    assert.equal(partner.bankIfscCode, 'SBIN0001234');
    assert.equal(partner.status, 'pending');

    const plus91 = validateDeliveryRegisterDto({
        name: `${tag} Again`, phone: `+91${phone}`, registrationToken: signRiderRegistrationToken(phone),
    });
    await assert.rejects(registerDeliveryPartner(plus91, {}, { phone: `+91${phone}` }), /already exists/);
});
