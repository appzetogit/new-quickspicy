import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone } from '../../../../utils/testIds.js';
import { deriveRestaurantFields, fromRestaurantLocation } from '../../restaurant/restaurant.mapper.js';
import { getReorderStores, groupHistory, matchLastVariant } from './reorder.service.js';
import { buildMenuFooter } from '../../restaurant/services/menuFooter.service.js';

/**
 * Reorder screen (C3) and the menu footer (C6). Seeding follows
 * search/services/phase2.test.js: restaurants at a real point with a radius.
 */
const stamp = `${Date.now()}`;
const LAT = 15.7355;
const LNG = 79.2697;
const at = { lat: String(LAT), lng: String(LNG) };
const created = { restaurants: [], foods: [], users: [], orders: [] };

const makeRestaurant = async (name, overrides = {}) => {
    const phone = uniquePhone('9');
    const row = await prisma.foodRestaurant.create({
        data: {
            restaurantName: `${name} ${stamp}`,
            ownerName: 'Owner',
            ownerPhone: phone,
            ...deriveRestaurantFields({ restaurantName: `${name} ${stamp}`, ownerPhone: phone }),
            ...fromRestaurantLocation({ latitude: LAT + created.restaurants.length * 0.002, longitude: LNG, city: 'Markapuram', state: 'AP' }),
            deliveryRadiusKm: 10,
            isAcceptingOrders: true,
            status: 'approved',
            ...overrides,
        },
    });
    created.restaurants.push(row.id);
    return row;
};

const makeFood = async (restaurant, name, price, extra = {}) => {
    const food = await prisma.foodItem.create({
        data: {
            restaurantId: restaurant.id, name: `${name} ${stamp}`, price,
            foodType: 'NonVeg', approvalStatus: 'approved', isAvailable: true, ...extra,
        },
    });
    created.foods.push(food.id);
    return food;
};

const makeUser = async () => {
    const user = await prisma.foodUser.create({ data: { phone: uniquePhone('7'), name: 'Reorder Tester' } });
    created.users.push(user.id);
    return user;
};

const makeOrder = async (user, restaurant, lines, { orderStatus = 'delivered', createdAt } = {}) => {
    const row = await prisma.foodOrder.create({
        data: {
            userId: user.id, restaurantId: restaurant.id, orderStatus, paymentMethod: 'cash',
            addrStreet: '1 Test Street', addrCity: 'Markapuram', addrState: 'AP', subtotal: 100, total: 100,
            ...(createdAt ? { createdAt } : {}),
            items: { create: lines.map((l) => ({ quantity: 1, price: 1, ...l })) },
        },
    });
    created.orders.push(row.id);
    return row;
};

test.after(async () => {
    await prisma.foodOrder.deleteMany({ where: { id: { in: created.orders } } });
    await prisma.foodItem.deleteMany({ where: { id: { in: created.foods } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.foodUser.deleteMany({ where: { id: { in: created.users } } });
    await prisma.$disconnect();
});

// ----- pure helpers -----

test('groupHistory: newest store first, latest line wins, counted once per order', () => {
    const a = 'a'.repeat(24);
    const b = 'b'.repeat(24);
    const dish = 'c'.repeat(24);
    const stores = groupHistory([
        { id: 'ord_new', order_id: 'QS1001', restaurantId: b, createdAt: new Date('2026-11-19'), items: [{ itemId: dish, name: 'New', variantName: 'Full' }, { itemId: dish, name: 'Dup' }] },
        { restaurantId: a, createdAt: new Date('2026-11-10'), items: [] },
        { restaurantId: b, createdAt: new Date('2026-11-01'), items: [{ itemId: dish, name: 'Old', variantName: 'Half' }] },
    ]);
    assert.deepEqual(stores.map((s) => s.restaurantId), [b, a]);
    const entry = stores[0].items.get(dish);
    assert.equal(entry.name, 'New');
    assert.equal(entry.variantName, 'Full');
    assert.equal(entry.timesOrdered, 2);
    assert.equal(stores[0].ordersCount, 2);
    // 162: the store remembers its newest order, to open it from Reorder.
    assert.deepEqual([stores[0].lastOrderId, stores[0].lastOrderDisplayId], ['ord_new', 'QS1001']);
});

test('matchLastVariant: by id, then by name, else flagged gone', () => {
    const variants = [{ id: 'v1', name: 'Half', price: 100 }, { id: 'v2', name: 'Full', price: 180 }];
    assert.equal(matchLastVariant({ variantId: 'v2', variantName: 'x' }, variants).name, 'Full');
    assert.equal(matchLastVariant({ variantId: 'old', variantName: 'half' }, variants).id, 'v1');
    const gone = matchLastVariant({ variantId: 'old', variantName: 'Family' }, variants);
    assert.equal(gone.stillExists, false);
    assert.equal(gone.name, 'Family');
    assert.equal(matchLastVariant({ variantId: '', variantName: '' }, variants), null);
});

test('menu footer: GST rate drives the tax note; packing 0; FSSAI and legal name', () => {
    const withGst = buildMenuFooter(
        { restaurantName: 'Spice Hut', gstLegalName: 'Spice Hut Foods LLP', fssaiNumber: '12345678901234', city: 'Ongole', state: 'AP' },
        { gstRate: 5 },
    );
    assert.equal(withGst.tax.pricesIncludeTax, false);
    assert.match(withGst.tax.note, /exclusive.*5%/);
    assert.equal(withGst.packagingCharge, 0);
    assert.equal(withGst.legalName, 'Spice Hut Foods LLP');
    assert.equal(withGst.fssaiNumber, '12345678901234');
    assert.equal(withGst.address, 'Ongole, AP');
    assert.equal(withGst.nutritionNote, null, 'no generic nutrition line without nutrition data (160)');
    assert.deepEqual(withGst.notes.map((n) => n.key), ['menu_disclaimer', 'taxes', 'packing', 'fssai']);

    const noGst = buildMenuFooter({ restaurantName: 'Plain' }, { gstRate: 0 });
    assert.equal(noGst.tax.pricesIncludeTax, true);
    assert.equal(noGst.legalName, 'Plain');
    assert.equal(noGst.fssaiNumber, null);
    assert.ok(!noGst.notes.some((n) => n.key === 'fssai'));

    const unknown = buildMenuFooter({ restaurantName: 'X' });
    assert.equal(unknown.tax.pricesIncludeTax, null);
});

// ----- the endpoint -----

test('reorder: stores newest first, today\'s prices, disabled items kept with a reason', async () => {
    const user = await makeUser();
    const older = await makeRestaurant('Reorder Older');
    const newer = await makeRestaurant('Reorder Newer');

    const biryani = await makeFood(newer, 'Qzr Biryani', 200, {
        description: 'Dum biryani',
        variants: { create: [{ name: 'Mutton half', price: 220 }, { name: 'Mutton full', price: 380 }] },
    });
    const full = await prisma.foodItemVariant.findFirst({ where: { foodItemId: biryani.id, name: 'Mutton full' } });
    const soldOut = await makeFood(newer, 'Qzr Soldout', 50);
    const deleted = await makeFood(newer, 'Qzr Deleted', 70);
    const dosa = await makeFood(older, 'Qzr Dosa', 90);
    const sizeGone = await makeFood(older, 'Qzr Pizza', 300, { variants: { create: [{ name: 'Large', price: 400 }] } });

    await makeOrder(user, older, [
        { itemId: dosa.id, name: dosa.name },
        { itemId: sizeGone.id, name: sizeGone.name, variantId: 'f'.repeat(24), variantName: 'Medium' },
    ], { createdAt: new Date(Date.now() - 3 * 86400000) });
    await makeOrder(user, newer, [
        { itemId: biryani.id, name: biryani.name, variantId: full.id, variantName: 'Mutton full', price: 350,
          addons: [{ addonId: 'e'.repeat(24), name: 'Extra raita', price: 20 }] },
        { itemId: soldOut.id, name: soldOut.name },
        { itemId: deleted.id, name: deleted.name, image: 'https://img.example/deleted.jpg' },
    ], { createdAt: new Date(Date.now() - 86400000) });
    // Not delivered: never counted.
    await makeOrder(user, older, [{ itemId: dosa.id, name: dosa.name }], { orderStatus: 'cancelled_by_user' });

    // After ordering: the full plate gets dearer, one sells out, one is deleted.
    await prisma.foodItemVariant.update({ where: { id: full.id }, data: { price: 400 } });
    await prisma.foodItem.update({ where: { id: soldOut.id }, data: { isAvailable: false } });
    await prisma.foodItem.delete({ where: { id: deleted.id } });

    const { stores } = await getReorderStores(user.id, at);
    assert.deepEqual(stores.map((s) => s.restaurant.id), [newer.id, older.id], 'most recent store first');

    const n = stores[0];
    assert.equal(typeof n.restaurant.isOpen, 'boolean');
    assert.equal(n.restaurant.isDeliverable, true);
    const b = n.items.find((i) => i.foodId === biryani.id);
    assert.equal(b.price, 400, 'current variant price, not the 350 paid');
    assert.equal(b.previousPrice, 350);
    assert.equal(b.description, 'Dum biryani');
    assert.deepEqual([b.lastVariant.name, b.lastVariant.stillExists], ['Mutton full', true]);
    assert.equal(b.needsVariantChoice, false);
    assert.deepEqual(b.lastAddons, [{ id: 'e'.repeat(24), name: 'Extra raita', stillAvailable: false }]);

    const s = n.items.find((i) => i.foodId === soldOut.id);
    assert.equal(s.isAvailable, false);
    assert.equal(s.unavailableReason, 'out_of_stock');
    assert.equal(s.canAdd, false);

    const d = n.items.find((i) => i.foodId === deleted.id);
    assert.equal(d.unavailableReason, 'discontinued', 'kept, not hidden');
    assert.equal(d.image, 'https://img.example/deleted.jpg', 'receipt image');
    assert.equal(d.price, null);

    const o = stores[1];
    const p = o.items.find((i) => i.foodId === sizeGone.id);
    assert.equal(p.lastVariant.stillExists, false);
    assert.equal(p.needsVariantChoice, true, 'previous size gone: ask, do not pick one');
    assert.equal(p.priceIsFrom, true);
    assert.equal(o.items.find((i) => i.foodId === dosa.id).timesOrdered, 1, 'cancelled order not counted');

    const one = await getReorderStores(user.id, { ...at, restaurantId: older.id });
    assert.deepEqual(one.stores.map((x) => x.restaurant.id), [older.id]);

    const stranger = await makeUser();
    assert.deepEqual(await getReorderStores(stranger.id, at), { stores: [] }, 'only the customer\'s own history');
});

test('reorder: a closed store is listed with its status and nothing is addable', async () => {
    const user = await makeUser();
    const closed = await makeRestaurant('Reorder Closed', { isAcceptingOrders: false });
    const dish = await makeFood(closed, 'Qzr Closed Dish', 120);
    await makeOrder(user, closed, [{ itemId: dish.id, name: dish.name }]);

    const { stores } = await getReorderStores(user.id, at);
    assert.equal(stores.length, 1);
    assert.equal(stores[0].restaurant.isOpen, false);
    assert.equal(stores[0].restaurant.closedReason, 'not-accepting-orders');
    const item = stores[0].items[0];
    assert.equal(item.isAvailable, true, 'the dish itself is fine');
    assert.equal(item.canAdd, false);
    assert.equal(item.blockedReason, 'store_closed');
});
