import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../../utils/testIds.js';
import { testPatch } from '../../../../utils/testGeo.js';
import { calculateOrderPricing, resolvePackagingFee } from './order-pricing.service.js';
import { createOrder } from './order.service.js';
import { buildInvoice } from './invoice.service.js';
import { buildMenuFooter } from '../../restaurant/services/menuFooter.service.js';
import { toPackagingCharge } from '../../admin/services/adminRestaurantWrite.helpers.js';
import { updateRestaurantById } from '../../admin/services/adminRestaurantWrite.service.js';
import {
    badgeFields,
    createHighlightBadge,
    deleteHighlightBadge,
    loadHighlightBadges,
    resolveBadgeWrite,
    restaurantBadgeKeys,
} from '../../admin/services/highlightBadge.service.js';
import { toOnboardingPin, validateRestaurantRegisterDto } from '../../restaurant/validators/restaurant.validator.js';

/**
 * Per-restaurant packing charge (priced, stored, billed, footer), several card
 * tags per restaurant, and the map pin required at self-registration.
 * Seeding follows orderAppFixes.test.js.
 */
const HERE = testPatch(44);
const created = { zones: [], restaurants: [], users: [], foods: [], badges: [] };
let zoneId;
let user;

const address = () => ({
    label: 'Home',
    name: 'Asha',
    phone: '9811122233',
    street: '1 Test Road',
    city: 'Indore',
    state: 'MP',
    zipCode: '452001',
    location: { type: 'Point', coordinates: [HERE.lng + 0.005, HERE.lat] },
});

const makeRestaurant = async (tag, data = {}) => {
    const restaurant = await prisma.foodRestaurant.create({
        data: {
            restaurantName: `${tag} Kitchen`,
            ownerName: 'Owner',
            ownerPhone: uniquePhone('9'),
            status: 'approved',
            zoneId,
            latitude: HERE.lat,
            longitude: HERE.lng,
            isAcceptingOrders: true,
            outsideHoursOverride: true,
            ...data,
        },
    });
    created.restaurants.push(restaurant.id);
    const food = await prisma.foodItem.create({
        data: { restaurantId: restaurant.id, name: `${tag} Thali`, price: 200, approvalStatus: 'approved', isAvailable: true },
    });
    created.foods.push(food.id);
    return { restaurant, food };
};

test.before(async () => {
    const tag = uniqueTag('Pack');
    const zone = await prisma.foodZone.create({ data: { name: `${tag} Zone`, coordinates: HERE.ring, isActive: true } });
    created.zones.push(zone.id);
    zoneId = zone.id;
    user = await prisma.foodUser.create({ data: { name: `${tag} Customer`, phone: uniquePhone('7') } });
    created.users.push(user.id);
});

test.after(async () => {
    const orders = await prisma.foodOrder.findMany({ where: { restaurantId: { in: created.restaurants } }, select: { id: true } });
    const ids = orders.map((o) => o.id);
    await prisma.foodNotification.deleteMany({ where: { ownerId: { in: created.users } } });
    await prisma.foodTransaction.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.foodOrderNotification.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.foodOrder.deleteMany({ where: { id: { in: ids } } });
    await prisma.foodItem.deleteMany({ where: { id: { in: created.foods } } });
    await prisma.foodRestaurantOutletTimings.deleteMany({ where: { restaurantId: { in: created.restaurants } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.foodHighlightBadge.deleteMany({ where: { id: { in: created.badges } } });
    await prisma.foodUser.deleteMany({ where: { id: { in: created.users } } });
    await prisma.foodZone.deleteMany({ where: { id: { in: created.zones } } });
    await prisma.$disconnect();
});

// ----- packing charge -----

test('resolvePackagingFee: flat per order, 0 for an empty cart or no charge', () => {
    assert.equal(resolvePackagingFee({ packagingCharge: '25.50' }, 400), 25.5);
    assert.equal(resolvePackagingFee({ packagingCharge: 25 }, 0), 0);
    assert.equal(resolvePackagingFee({ packagingCharge: 0 }, 400), 0);
    assert.equal(resolvePackagingFee({}, 400), 0);
    assert.equal(resolvePackagingFee(null, 400), 0);
});

test('toPackagingCharge: blank is 0, negative and over ₹500 refused', () => {
    assert.equal(toPackagingCharge(''), 0);
    assert.equal(toPackagingCharge(null), 0);
    assert.equal(toPackagingCharge('12.345'), 12.35);
    assert.equal(toPackagingCharge(500), 500);
    assert.throws(() => toPackagingCharge(-1), /negative/);
    assert.throws(() => toPackagingCharge(501), /500/);
    assert.throws(() => toPackagingCharge('abc'), /number/);
});

test('the packing charge is in /calculate and the placed order, and they agree', async () => {
    const tag = uniqueTag('Pk');
    const plain = await makeRestaurant(`${tag}A`);
    const packed = await makeRestaurant(`${tag}B`, { packagingCharge: 25 });

    const quote = (r) => calculateOrderPricing(user.id, {
        restaurantId: r.restaurant.id,
        items: [{ itemId: r.food.id, name: 'Thali', price: 200, quantity: 2 }],
        deliveryAddress: address(),
    });
    const [a, b] = await Promise.all([quote(plain), quote(packed)]);

    assert.equal(a.pricing.packagingFee, 0);
    assert.equal(b.pricing.packagingFee, 25, 'per order, not per item (quantity 2)');
    // Outside the GST base: tax is on the food only.
    assert.equal(b.pricing.tax, a.pricing.tax);
    assert.equal(b.pricing.total, Math.round((a.pricing.total + 25) * 100) / 100);

    const { order } = await createOrder(user.id, {
        restaurantId: packed.restaurant.id,
        items: [{ itemId: packed.food.id, name: 'Thali', price: 200, quantity: 2 }],
        address: address(),
        pricing: { subtotal: 400, total: b.pricing.total },
        paymentMethod: 'cash',
    });
    const row = await prisma.foodOrder.findUnique({ where: { id: order._id || order.id } });
    assert.equal(Number(row.packagingFee), 25);
    assert.equal(Number(row.total), b.pricing.total, 'place-order charges what /calculate quoted');

    // The bill prints it and still adds up.
    const invoice = buildInvoice({ order: { ...row, items: [] } });
    assert.ok(invoice.charges.some((l) => l.label === 'Packaging charge' && l.amount === 25));
    assert.equal(invoice.notes.reconciled, true);
});

test('menu footer states the real packing charge', () => {
    const none = buildMenuFooter({ restaurantName: 'A' }, { gstRate: 5 });
    assert.equal(none.packagingCharge, 0);
    assert.match(none.packagingNote, /No packing charges/);

    const some = buildMenuFooter({ restaurantName: 'B', packagingCharge: '20.00' }, { gstRate: 5 });
    assert.equal(some.packagingCharge, 20);
    assert.match(some.packagingNote, /₹20 per order/);
    assert.equal(some.notes.find((n) => n.key === 'packing').text, some.packagingNote);

    const odd = buildMenuFooter({ restaurantName: 'C', packagingCharge: 12.5 }, { gstRate: 5 });
    assert.match(odd.packagingNote, /₹12\.50 per order/);
});

test('admin edit sets the packing charge', async () => {
    const { restaurant } = await makeRestaurant(uniqueTag('PkE'));
    await updateRestaurantById(restaurant.id, { packagingCharge: '15' });
    let row = await prisma.foodRestaurant.findUnique({ where: { id: restaurant.id }, select: { packagingCharge: true } });
    assert.equal(Number(row.packagingCharge), 15);
    await updateRestaurantById(restaurant.id, { packagingCharge: '' });
    row = await prisma.foodRestaurant.findUnique({ where: { id: restaurant.id }, select: { packagingCharge: true } });
    assert.equal(Number(row.packagingCharge), 0);
    await assert.rejects(() => updateRestaurantById(restaurant.id, { packagingCharge: 900 }), /500/);
});

// ----- several tags -----

test('restaurantBadgeKeys falls back to the single legacy tag', () => {
    assert.deepEqual(restaurantBadgeKeys({ highlightBadges: ['a', 'b'], highlightBadge: 'a' }), ['a', 'b']);
    assert.deepEqual(restaurantBadgeKeys({ highlightBadges: [], highlightBadge: 'x' }), ['x']);
    assert.deepEqual(restaurantBadgeKeys({}), []);
});

test('several tags: validated, ordered, mirrored into highlightBadge, cleared on delete', async () => {
    const t = uniqueTag('b').toLowerCase().slice(0, 10);
    const one = await createHighlightBadge({ label: `${t} one`, color: '#112233' });
    const two = await createHighlightBadge({ label: `${t} two` });
    created.badges.push(one.id, two.id);

    assert.equal(await resolveBadgeWrite({}), undefined, 'untouched when the body has neither field');
    assert.deepEqual(await resolveBadgeWrite({ highlightBadges: [two.key, one.key, two.key] }), {
        highlightBadges: [two.key, one.key],
        highlightBadge: two.key,
    });
    // An old client sending one tag sets the list to it.
    assert.deepEqual(await resolveBadgeWrite({ highlightBadge: one.key }), { highlightBadges: [one.key], highlightBadge: one.key });
    assert.deepEqual(await resolveBadgeWrite({ highlightBadges: [] }), { highlightBadges: [], highlightBadge: null });
    await assert.rejects(() => resolveBadgeWrite({ highlightBadges: [one.key, 'no_such_tag_zz'] }), /Unknown tag/);

    const { restaurant } = await makeRestaurant(uniqueTag('Tg'));
    await updateRestaurantById(restaurant.id, { highlightBadges: [one.key, two.key] });
    let row = await prisma.foodRestaurant.findUnique({ where: { id: restaurant.id } });
    assert.deepEqual(row.highlightBadges, [one.key, two.key]);
    assert.equal(row.highlightBadge, one.key);

    await loadHighlightBadges({ fresh: true });
    const fields = badgeFields(row);
    assert.deepEqual(fields.highlightBadges, [one.key, two.key]);
    assert.equal(fields.highlightBadgesInfo[0].color, '#112233');
    assert.equal(fields.highlightBadge, one.key, 'older builds get the first tag');
    assert.equal(fields.highlightBadgeInfo.key, one.key);

    await deleteHighlightBadge(one.id);
    created.badges = created.badges.filter((id) => id !== one.id);
    row = await prisma.foodRestaurant.findUnique({ where: { id: restaurant.id } });
    assert.deepEqual(row.highlightBadges, [two.key]);
    assert.equal(row.highlightBadge, two.key);
});

// ----- the sign-up map pin -----

test('self-registration validates the map pin, and still accepts none from older apps', () => {
    assert.deepEqual(toOnboardingPin('22.7196', '75.8577'), { latitude: 22.7196, longitude: 75.8577 });
    assert.throws(() => toOnboardingPin('', '75.8'), /drop a pin/);
    assert.deepEqual(toOnboardingPin(undefined, undefined), {}, 'no pin at all: older app builds');
    assert.throws(() => toOnboardingPin('0', '0'), /drop a pin/);
    assert.throws(() => toOnboardingPin('95', '75'), /not a valid location/);
    assert.throws(() => toOnboardingPin('abc', '75'), /not a valid location/);

    const signup = { restaurantName: 'R', ownerName: 'O', pureVegRestaurant: 'false' };
    const noPin = validateRestaurantRegisterDto(signup);
    assert.equal(noPin.latitude, undefined);
    const ok = validateRestaurantRegisterDto({ ...signup, latitude: '22.7196', longitude: '75.8577', deliveryRadiusKm: '5' });
    assert.equal(ok.latitude, 22.7196);
    assert.equal(ok.longitude, 75.8577);
    assert.equal(ok.deliveryRadiusKm, 5, 'the delivery radius still comes through');
});
