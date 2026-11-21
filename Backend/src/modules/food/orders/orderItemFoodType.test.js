import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../utils/testIds.js';
import { testPatch } from '../../../utils/testGeo.js';
import { deriveRestaurantFields, fromRestaurantLocation } from '../restaurant/restaurant.mapper.js';
import { toOrder, orderItemFoodType } from './order.mapper.js';
import { resolveOrderCartItems } from './helpers/order-cart-items.helper.js';
import { buildInvoice, renderInvoiceHtml } from './services/invoice.service.js';
import { getPopularItemsReport } from '../admin/services/reportPopular.service.js';
import { getReorderStores } from '../user/services/reorder.service.js';

/**
 * Order lines record the dish's diet (foodType), so Egg dishes stop showing
 * as non-veg on orders, invoices, the popular-items report and reorder.
 * Seeding follows reorder.test.js / reportInsights.test.js.
 */
const HERE = testPatch(37);
const DAY = '2026-01-14';
const created = { zones: [], restaurants: [], foods: [], users: [], orders: [] };
let zoneId = null;
let restaurant = null;
let userId = null;

test.before(async () => {
    const zone = await prisma.foodZone.create({
        data: { name: `Diet Zone ${uniqueTag('Z')}`, coordinates: HERE.ring },
    });
    created.zones.push(zone.id);
    zoneId = zone.id;

    const phone = uniquePhone('9');
    const name = `Diet House ${uniqueTag('R')}`;
    restaurant = await prisma.foodRestaurant.create({
        data: {
            restaurantName: name,
            ownerName: 'Owner',
            ownerPhone: phone,
            ...deriveRestaurantFields({ restaurantName: name, ownerPhone: phone }),
            ...fromRestaurantLocation({ latitude: HERE.lat, longitude: HERE.lng, city: 'Test', state: 'TS' }),
            deliveryRadiusKm: 10,
            isAcceptingOrders: true,
            status: 'approved',
            zoneId,
        },
    });
    created.restaurants.push(restaurant.id);

    const u = await prisma.foodUser.create({ data: { phone: uniquePhone('7'), name: 'Diet Tester' } });
    created.users.push(u.id);
    userId = u.id;
});

test.after(async () => {
    await prisma.foodOrder.deleteMany({ where: { id: { in: created.orders } } });
    await prisma.foodItem.deleteMany({ where: { id: { in: created.foods } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.foodUser.deleteMany({ where: { id: { in: created.users } } });
    await prisma.foodZone.deleteMany({ where: { id: { in: created.zones } } });
    await prisma.$disconnect();
});

const makeFood = async (label, foodType) => {
    const food = await prisma.foodItem.create({
        data: {
            restaurantId: restaurant.id, name: `${label} ${uniqueTag('F')}`, price: 120,
            foodType, approvalStatus: 'approved', isAvailable: true,
        },
    });
    created.foods.push(food.id);
    return food;
};

const makeOrder = async (lines, over = {}) => {
    const row = await prisma.foodOrder.create({
        data: {
            userId, restaurantId: restaurant.id, zoneId, order_id: uniqueTag('QS'),
            orderStatus: 'delivered', paymentMethod: 'cash',
            addrStreet: '1 Test Street', addrCity: 'Test', addrState: 'TS', subtotal: 120, total: 120,
            createdAt: new Date(`${DAY}T13:00:00+05:30`),
            ...over,
            items: { create: lines.map((l) => ({ quantity: 1, price: 120, ...l })) },
        },
    });
    created.orders.push(row.id);
    return row;
};

// ----- pure -----

test('orderItemFoodType: recorded diet wins, isVeg is the fallback', () => {
    assert.equal(orderItemFoodType({ foodType: 'Egg', isVeg: false }), 'Egg');
    assert.equal(orderItemFoodType({ foodType: 'NonVeg', isVeg: false }), 'Non-Veg');
    assert.equal(orderItemFoodType({ foodType: 'Veg', isVeg: true }), 'Veg');
    assert.equal(orderItemFoodType({ foodType: null, isVeg: false }), 'Non-Veg');
    assert.equal(orderItemFoodType({ isVeg: true }), 'Veg');
});

test('toOrder emits foodType in the wire form on every line', () => {
    const order = toOrder({
        id: 'o1', items: [
            { name: 'Egg Curry', price: 1, isVeg: false, foodType: 'Egg' },
            { name: 'Chicken', price: 1, isVeg: false, foodType: 'NonVeg' },
            { name: 'Old line', price: 1, isVeg: true },
        ],
    });
    assert.deepEqual(order.items.map((i) => i.foodType), ['Egg', 'Non-Veg', 'Veg']);
    assert.deepEqual(order.items.map((i) => i.isVeg), [false, false, true], 'isVeg unchanged');
});

test('invoice: Egg lines get the egg mark, not the non-veg one', () => {
    const invoice = buildInvoice({
        order: {
            id: '1a2b3c4d5e6f7a8b9c0d1e2f', order_id: 'QS1', currency: 'INR', orderStatus: 'delivered',
            createdAt: new Date('2026-09-14T10:00:00.000Z'), subtotal: 120, total: 120,
            paymentMethod: 'cash', paymentStatus: 'paid', addrStreet: '1 Road', addrCity: 'Indore',
            items: [{ name: 'Egg Bhurji', price: 120, quantity: 1, isVeg: false, foodType: 'Egg', addons: [] }],
            restaurant: { restaurantName: 'Test Hotel' },
        },
    });
    assert.equal(invoice.items[0].foodType, 'Egg');
    assert.equal(invoice.items[0].isVeg, false);
    const html = renderInvoiceHtml(invoice);
    assert.match(html, /class="dot egg"/);
    assert.doesNotMatch(html, /class="dot nonveg"/);
});

// ----- database -----

test('order placement records the dish foodType on the line', async () => {
    const egg = await makeFood('Egg Fried Rice', 'Egg');
    const veg = await makeFood('Veg Fried Rice', 'Veg');
    const lines = await resolveOrderCartItems(restaurant.id, [
        { itemId: egg.id, quantity: 1 },
        { itemId: veg.id, quantity: 1 },
    ]);
    const byId = new Map(lines.map((l) => [l.itemId, l]));
    assert.equal(byId.get(egg.id).foodType, 'Egg');
    assert.equal(byId.get(egg.id).isVeg, false, 'isVeg kept as is');
    assert.equal(byId.get(veg.id).foodType, 'Veg');
    assert.equal(byId.get(veg.id).isVeg, true);
});

test('popular items and reorder show Egg, even after the dish is deleted', async () => {
    const egg = await makeFood('Egg Roll', 'Egg');
    await makeOrder([{ itemId: egg.id, name: egg.name, isVeg: false, foodType: 'Egg' }]);

    const report = await getPopularItemsReport({ from: DAY, to: DAY, zoneId });
    const row = report.topItems.find((i) => i.itemId === egg.id);
    assert.equal(row.foodType, 'Egg');
    assert.equal(row.isVeg, false);

    await prisma.foodItem.delete({ where: { id: egg.id } });
    const { stores } = await getReorderStores(userId, { lat: String(HERE.lat), lng: String(HERE.lng) });
    const item = stores.flatMap((s) => s.items).find((i) => i.foodId === egg.id);
    assert.equal(item.unavailableReason, 'discontinued');
    assert.equal(item.foodType, 'Egg', 'from the receipt, not isVeg');
    assert.equal(item.isVeg, false);
});
