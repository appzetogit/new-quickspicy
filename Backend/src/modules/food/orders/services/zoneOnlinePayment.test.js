import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../../utils/testIds.js';
import { testPatch } from '../../../../utils/testGeo.js';
import { recordTransaction } from '../../../../core/payments/transaction.service.js';
import { __setRazorpayForTests } from '../helpers/razorpay.helper.js';
import { calculateOrder, createOrder } from './order.service.js';
import { parseZoneCodSettings, setPlatformCodEnabled, resolvePlatformCodEnabled } from './codAvailability.service.js';
import {
    decideOnlinePayment,
    decideNoPaymentMethod,
    effectiveOnlinePayment,
    onlinePaymentMessage,
    isOnlinePaymentAvailable,
    ONLINE_PAYMENT_OFF_MESSAGE,
    NO_PAYMENT_METHOD_MESSAGE,
} from './onlinePaymentAvailability.service.js';
import { getCodSettings, updateZoneCodSettings } from '../../admin/controllers/admin.controller.js';

/**
 * Online payment switched off for one zone.
 *
 * The rules: an online order (or the online part of a wallet split) in a zone
 * with online off is refused before anything is saved; cash and wallet-only
 * orders there still go through; other zones are untouched; and checkout's
 * preview says the same thing the order path does.
 */

// ----- The rule on its own -----

test('a zone that says nothing takes online payments', () => {
    assert.equal(decideOnlinePayment(null).allowed, true);
    assert.equal(decideOnlinePayment(undefined).allowed, true);
    assert.equal(decideOnlinePayment({ onlinePaymentEnabled: null }).allowed, true);
    assert.equal(decideOnlinePayment({}).allowed, true);
});

test('only an explicit false turns it off', () => {
    assert.deepEqual(decideOnlinePayment({ onlinePaymentEnabled: false }), { allowed: false, reason: 'zone-off' });
    assert.equal(decideOnlinePayment({ onlinePaymentEnabled: true }).allowed, true);
    for (const notFalse of [0, '', 'false', undefined]) {
        assert.equal(decideOnlinePayment({ onlinePaymentEnabled: notFalse }).allowed, true, String(notFalse));
    }
});

test('the customer message says what to do and never the internal reason', () => {
    assert.equal(onlinePaymentMessage('ok'), '');
    assert.equal(onlinePaymentMessage('zone-off'), ONLINE_PAYMENT_OFF_MESSAGE);
    assert.ok(!ONLINE_PAYMENT_OFF_MESSAGE.includes('zone-off'));
    assert.match(ONLINE_PAYMENT_OFF_MESSAGE, /cash on delivery/i);
});

test('no payment method only when cash, online and a full wallet are all out', () => {
    assert.equal(decideNoPaymentMethod({ codAllowed: false, onlineAllowed: false }), true);
    assert.equal(decideNoPaymentMethod({ codAllowed: false, onlineAllowed: false, walletCoversAll: true }), false);
    assert.equal(decideNoPaymentMethod({ codAllowed: true, onlineAllowed: false }), false);
    assert.equal(decideNoPaymentMethod({ codAllowed: false, onlineAllowed: true }), false);
});

test('the admin view warns when both are off for everyone', () => {
    const codOffForAll = { newCustomer: { allowed: false }, returningCustomer: { allowed: false } };
    const codOn = { newCustomer: { allowed: true }, returningCustomer: { allowed: true } };
    const off = { onlinePaymentEnabled: false };
    assert.equal(effectiveOnlinePayment(off, codOffForAll).bothOff, true);
    assert.equal(effectiveOnlinePayment(off, codOn).bothOff, false);
    assert.equal(effectiveOnlinePayment({ onlinePaymentEnabled: null }, codOffForAll).bothOff, false);
    // COD only for returning customers is still a way to pay here.
    const codReturningOnly = { newCustomer: { allowed: false }, returningCustomer: { allowed: true } };
    assert.equal(effectiveOnlinePayment(off, codReturningOnly).bothOff, false);
});

test('the zone patch reads onlinePaymentEnabled as tri-state', () => {
    for (const [sent, stored] of [[true, true], ['true', true], [false, false], ['false', false], [null, null], ['null', null], ['', null]]) {
        assert.deepEqual(parseZoneCodSettings({ onlinePaymentEnabled: sent }).data, { onlinePaymentEnabled: stored }, String(sent));
    }
    for (const bad of ['yes', 1, 0, {}]) {
        assert.ok(parseZoneCodSettings({ onlinePaymentEnabled: bad }).error, JSON.stringify(bad));
    }
    // Sent with the COD fields, all three land together.
    assert.deepEqual(parseZoneCodSettings({ codEnabled: false, onlinePaymentEnabled: false }).data, {
        codEnabled: false,
        onlinePaymentEnabled: false,
    });
});

// ----- Against the database -----

const OFF = testPatch(47);
const ON = testPatch(48);
const created = { zones: [], restaurants: [], users: [], foods: [], categories: [] };
const site = { off: null, on: null };
let tag = null;
let platformCodBefore = true;

const fakeRazorpay = {
    seq: 0,
    orders: {
        create: async ({ amount, currency, receipt, notes }) => ({
            id: `order_${tag}${++fakeRazorpay.seq}`, amount, currency, receipt, notes: notes || {}, status: 'created',
        }),
        fetch: async () => null,
        fetchPayments: async () => ({ items: [] }),
    },
    payments: { fetch: async () => null },
};

async function kitchenIn(patch, zoneData) {
    const zone = await prisma.foodZone.create({
        data: { name: `${tag} Zone ${patch.lat}`, coordinates: patch.ring, isActive: true, ...zoneData },
    });
    created.zones.push(zone.id);
    const restaurant = await prisma.foodRestaurant.create({
        data: {
            restaurantName: `${tag} Kitchen ${patch.lat}`, ownerName: 'Owner', ownerPhone: uniquePhone('9'),
            status: 'approved', zoneId: zone.id, latitude: patch.lat, longitude: patch.lng,
            isAcceptingOrders: true, outsideHoursOverride: true,
        },
    });
    created.restaurants.push(restaurant.id);
    const category = await prisma.foodCategory.create({
        data: { name: `${tag} Mains ${patch.lat}`, restaurantId: restaurant.id, approvalStatus: 'approved' },
    });
    created.categories.push(category.id);
    const food = await prisma.foodItem.create({
        data: {
            restaurantId: restaurant.id, categoryId: category.id, categoryName: category.name,
            name: `${tag} Biryani`, price: 250, approvalStatus: 'approved', isAvailable: true,
        },
    });
    created.foods.push(food.id);
    return { zoneId: zone.id, restaurantId: restaurant.id, foodId: food.id, patch };
}

const cart = (where, extra = {}) => ({
    restaurantId: where.restaurantId,
    items: [{ itemId: where.foodId, quantity: 2 }],
    address: {
        label: 'Home', fullName: 'Test Customer', street: '1 Test Street', city: 'Indore',
        state: 'MP', zipCode: '452001', phone: uniquePhone('5'),
        latitude: where.patch.lat, longitude: where.patch.lng,
    },
    paymentMethod: 'razorpay',
    ...extra,
});

async function customerWithWallet(rupees = 0) {
    const user = await prisma.foodUser.create({ data: { name: `${tag} Customer`, phone: uniquePhone('5') } });
    created.users.push(user.id);
    if (rupees > 0) {
        await recordTransaction({
            entityType: 'user', entityId: user.id, type: 'credit', amount: rupees,
            description: 'Test top-up', category: 'wallet_topup',
        });
    }
    return user.id;
}

/** A controller call with a fake req/res; resolves with { status, body }. */
function callController(handler, req) {
    return new Promise((resolve, reject) => {
        const res = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(body) { resolve({ status: this.statusCode, body }); return this; },
        };
        Promise.resolve(handler({ params: {}, query: {}, body: {}, ...req }, res, reject)).catch(reject);
    });
}

test.before(async () => {
    tag = uniqueTag('ZOnl');
    __setRazorpayForTests(fakeRazorpay, { keySecret: 'zone_online_secret' });
    // The COD-in-an-online-off-zone cases need COD on platform-wide.
    platformCodBefore = await resolvePlatformCodEnabled();
    await setPlatformCodEnabled(true);
    site.off = await kitchenIn(OFF, { onlinePaymentEnabled: false });
    site.on = await kitchenIn(ON, {});
});

test.after(async () => {
    __setRazorpayForTests(null);
    await setPlatformCodEnabled(platformCodBefore);
    const orders = await prisma.foodOrder.findMany({ where: { restaurantId: { in: created.restaurants } }, select: { id: true } });
    const ids = orders.map((o) => o.id);
    await prisma.foodOrderRefund.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.foodTransaction.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.transaction.deleteMany({ where: { entityId: { in: created.users } } });
    await prisma.transaction.updateMany({ where: { orderId: { in: ids } }, data: { orderId: null } });
    await prisma.wallet.deleteMany({ where: { entityId: { in: created.users } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.foodOrder.deleteMany({ where: { id: { in: ids } } });
    await prisma.foodItem.deleteMany({ where: { id: { in: created.foods } } });
    await prisma.foodCategory.deleteMany({ where: { id: { in: created.categories } } });
    await prisma.foodUser.deleteMany({ where: { id: { in: created.users } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.foodZone.deleteMany({ where: { id: { in: created.zones } } });
    await prisma.$disconnect();
});

test('the lookup reads the zone', async () => {
    assert.equal((await isOnlinePaymentAvailable({ zoneId: site.off.zoneId })).allowed, false);
    assert.equal((await isOnlinePaymentAvailable({ zoneId: site.on.zoneId })).allowed, true);
    assert.equal((await isOnlinePaymentAvailable({ zoneId: null })).allowed, true);
});

test('an online order is refused where online is off, and nothing is saved', async () => {
    const userId = await customerWithWallet();
    await assert.rejects(() => createOrder(userId, cart(site.off)), (err) => err.message === ONLINE_PAYMENT_OFF_MESSAGE);
    // 'card' is the same online checkout.
    await assert.rejects(() => createOrder(userId, cart(site.off, { paymentMethod: 'card' })), /Online payment is not available/);
    assert.equal(await prisma.foodOrder.count({ where: { userId } }), 0);
});

test("sending another zone's id does not get round the restaurant's zone", async () => {
    const userId = await customerWithWallet();
    await assert.rejects(
        () => createOrder(userId, cart(site.off, { zoneId: site.on.zoneId })),
        (err) => err.message === ONLINE_PAYMENT_OFF_MESSAGE,
    );
    assert.equal(await prisma.foodOrder.count({ where: { userId } }), 0);
});

test('a wallet + online split is refused there too when the online part is above 0', async () => {
    const userId = await customerWithWallet(100);
    await assert.rejects(() => createOrder(userId, cart(site.off, { useWallet: true })), /Online payment is not available/);
    assert.equal(await prisma.foodOrder.count({ where: { userId } }), 0);
});

test('cash and wallet-only orders still go through where online is off', async () => {
    const cashUser = await customerWithWallet();
    const cash = await createOrder(cashUser, cart(site.off, { paymentMethod: 'cash' }));
    assert.ok(cash.order, 'cash order placed');

    const walletUser = await customerWithWallet(5000);
    const wallet = await createOrder(walletUser, cart(site.off, { paymentMethod: 'wallet' }));
    assert.ok(wallet.order, 'wallet order placed');

    // Online + "use my wallet" with a wallet that covers it all is a wallet order.
    const coveredUser = await customerWithWallet(5000);
    const covered = await createOrder(coveredUser, cart(site.off, { useWallet: true }));
    assert.ok(covered.order, 'fully wallet-covered order placed');
    assert.equal(covered.razorpay ?? null, null, 'no gateway order');
});

test('online orders in other zones are untouched', async () => {
    const userId = await customerWithWallet();
    const placed = await createOrder(userId, cart(site.on));
    assert.ok(placed.order);
    assert.ok(placed.razorpay?.orderId, 'a Razorpay order was created');
});

test('with cash off as well, the refusal says no method is available', async () => {
    await prisma.foodZone.update({ where: { id: site.off.zoneId }, data: { codEnabled: false } });
    try {
        const userId = await customerWithWallet();
        await assert.rejects(() => createOrder(userId, cart(site.off)), (err) => err.message === NO_PAYMENT_METHOD_MESSAGE);
    } finally {
        await prisma.foodZone.update({ where: { id: site.off.zoneId }, data: { codEnabled: null } });
    }
});

test('the checkout preview reports what the order path would do', async () => {
    const userId = await customerWithWallet();
    const off = await calculateOrder(userId, cart(site.off));
    assert.equal(off.paymentAvailability.onlinePaymentAvailable, false);
    assert.equal(off.paymentAvailability.onlinePaymentMessage, ONLINE_PAYMENT_OFF_MESSAGE);
    assert.equal(off.paymentAvailability.codAvailable, true);
    assert.equal(off.paymentAvailability.noPaymentMethodAvailable, false);

    const on = await calculateOrder(userId, cart(site.on));
    assert.equal(on.paymentAvailability.onlinePaymentAvailable, true);
    assert.equal(on.paymentAvailability.onlinePaymentMessage, '');

    await prisma.foodZone.update({ where: { id: site.off.zoneId }, data: { codEnabled: false } });
    try {
        const none = await calculateOrder(userId, cart(site.off));
        assert.equal(none.paymentAvailability.codAvailable, false);
        assert.equal(none.paymentAvailability.noPaymentMethodAvailable, true);
        assert.equal(none.paymentAvailability.noPaymentMethodMessage, NO_PAYMENT_METHOD_MESSAGE);

        // A wallet that covers the order is still a way to pay.
        const rich = await customerWithWallet(5000);
        const covered = await calculateOrder(rich, cart(site.off));
        assert.equal(covered.paymentAvailability.noPaymentMethodAvailable, false);
    } finally {
        await prisma.foodZone.update({ where: { id: site.off.zoneId }, data: { codEnabled: null } });
    }
});

test('admin: the zone patch saves the online switch and the read shows it', async () => {
    const zoneId = site.on.zoneId;
    const saved = await callController(updateZoneCodSettings, { params: { id: zoneId }, body: { onlinePaymentEnabled: false } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.data.zone.onlinePaymentEnabled, false);
    assert.equal(saved.body.data.zone.effectiveOnlinePayment.allowed, false);
    // COD fields untouched by an online-only patch.
    assert.equal(saved.body.data.zone.codEnabled, null);

    const read = await callController(getCodSettings, {});
    const row = read.body.data.zones.find((z) => z.id === zoneId);
    assert.equal(row.onlinePaymentEnabled, false);
    assert.ok(row.effective?.newCustomer, 'the COD summary keeps its shape');
    assert.equal(read.body.data.platformOnlinePaymentEnabled, true);

    // Both off is allowed, and flagged.
    const both = await callController(updateZoneCodSettings, { params: { id: zoneId }, body: { codEnabled: false } });
    assert.equal(both.body.data.zone.effectiveOnlinePayment.bothOff, true);

    // Back to "platform default".
    const reset = await callController(updateZoneCodSettings, {
        params: { id: zoneId }, body: { onlinePaymentEnabled: null, codEnabled: null },
    });
    assert.equal(reset.body.data.zone.onlinePaymentEnabled, null);
    assert.equal(reset.body.data.zone.effectiveOnlinePayment.allowed, true);

    const bad = await callController(updateZoneCodSettings, { params: { id: zoneId }, body: { onlinePaymentEnabled: 'maybe' } });
    assert.equal(bad.status, 400);
});
