import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../../utils/testIds.js';
import { testPatch } from '../../../../utils/testGeo.js';
import {
    calculateOrder,
    createOrder,
    getOrderById,
    cancelOrder,
    listOrdersUser,
    updateOrderStatusRestaurant,
} from './order.service.js';

/**
 * The order lifecycle, through the real entry points.
 *
 * Everything here goes through createOrder() with the DTO a controller passes,
 * rather than through hand-built rows. Fixtures assembled from the schema
 * instead of from the call site are what produced a confident wrong claim
 * earlier in this work: a raw Prisma row made the ledger writer look broken
 * when production maps the row first and it was fine.
 */
const HERE = testPatch(7);

const created = { zones: [], restaurants: [], users: [], foods: [], categories: [], orders: [] };
let restaurantId = null;
let userId = null;
let foodId = null;
let tag = null;

const address = () => ({
    label: 'Home',
    fullName: 'Test Customer',
    street: '1 Test Street',
    city: 'Indore',
    state: 'MP',
    zipCode: '452001',
    phone: uniquePhone('5'),
    latitude: HERE.lat,
    longitude: HERE.lng,
});

test.before(async () => {
    tag = uniqueTag('Flow');

    const zone = await prisma.foodZone.create({
        data: { name: `${tag} Zone`, coordinates: HERE.ring, isActive: true },
    });
    created.zones.push(zone.id);

    const restaurant = await prisma.foodRestaurant.create({
        data: {
            restaurantName: `${tag} Kitchen`,
            ownerName: 'Owner',
            ownerPhone: uniquePhone('9'),
            status: 'approved',
            zoneId: zone.id,
            latitude: HERE.lat,
            longitude: HERE.lng,
            isAcceptingOrders: true,
            // Hours are wall-clock dependent; the override keeps the fixture
            // deterministic whatever time the suite runs at.
            outsideHoursOverride: true,
        },
    });
    created.restaurants.push(restaurant.id);
    restaurantId = restaurant.id;

    const category = await prisma.foodCategory.create({
        data: { name: `${tag} Mains`, restaurantId, approvalStatus: 'approved' },
    });
    created.categories.push(category.id);

    const food = await prisma.foodItem.create({
        data: {
            restaurantId,
            categoryId: category.id,
            categoryName: category.name,
            name: `${tag} Biryani`,
            price: 250,
            approvalStatus: 'approved',
            isAvailable: true,
        },
    });
    created.foods.push(food.id);
    foodId = food.id;

    const user = await prisma.foodUser.create({
        data: { name: `${tag} Customer`, phone: uniquePhone('5') },
    });
    created.users.push(user.id);
    userId = user.id;
});

test.after(async () => {
    await prisma.foodOffer.deleteMany({ where: { id: { in: created.offers || [] } } });
    await prisma.foodNotification.deleteMany({ where: { ownerType: 'USER', ownerId: { in: created.users } } });
    const orders = await prisma.foodOrder.findMany({
        where: { restaurantId: { in: created.restaurants } }, select: { id: true },
    });
    const ids = orders.map((o) => o.id);
    await prisma.foodTransaction.deleteMany({ where: { orderId: { in: ids } } });
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

const cartOf = (quantity = 2) => ({
    restaurantId,
    items: [{ itemId: foodId, quantity }],
    address: address(),
    paymentMethod: 'cash',
});

test('the same dish in two sizes is not reported as a price change', async () => {
    const food = await prisma.foodItem.create({
        data: {
            restaurantId,
            name: 'Sized pastry',
            price: 100,
            approvalStatus: 'approved',
            isAvailable: true,
            variants: { create: [{ name: '1 piece', price: 100 }, { name: '2 piece', price: 200, sortOrder: 1 }] },
        },
        include: { variants: true },
    });
    created.foods.push(food.id);
    const one = food.variants.find((v) => v.name === '1 piece');
    const two = food.variants.find((v) => v.name === '2 piece');
    try {
        const quote = await calculateOrder(userId, {
            ...cartOf(1),
            items: [
                { itemId: food.id, variantId: one.id, quantity: 1, price: 100 },
                { itemId: food.id, variantId: two.id, quantity: 1, price: 200 },
            ],
        });
        assert.deepEqual(quote.priceChanges, []);
        assert.equal(quote.pricing.subtotal, 300);

        // A real drift on the second line is still caught, against that line's own size.
        const drift = await calculateOrder(userId, {
            ...cartOf(1),
            items: [
                { itemId: food.id, variantId: one.id, quantity: 1, price: 100 },
                { itemId: food.id, variantId: two.id, quantity: 1, price: 180 },
            ],
        });
        assert.equal(drift.priceChanges.length, 1);
        assert.equal(drift.priceChanges[0].previousPrice, 180);
        assert.equal(drift.priceChanges[0].price, 200);
    } finally {
        await prisma.foodItemVariant.deleteMany({ where: { foodItemId: food.id } });
    }
});

test('the cart totals before anything is written', async () => {
    const quote = await calculateOrder(userId, cartOf(2));

    assert.ok(quote, 'a quote comes back');
    // Two of a 250 dish. Everything else layers on top of this.
    assert.equal(Number(quote.pricing.subtotal), 500);
    assert.ok(Number(quote.pricing.total) >= 500, 'the total is at least the subtotal');
    assert.equal(quote.items.length, 1);
});

test('a cash order is written with the money the quote promised', async () => {
    const quote = await calculateOrder(userId, cartOf(2));
    const { order } = await createOrder(userId, cartOf(2));

    assert.ok(order, 'an order comes back');
    assert.match(order.orderId, /^QS\d{6}\d{5,}$/, 'it gets a readable display id: QS + DDMMYY + running number');
    created.orders.push(order._id || order.id);

    // What the customer was quoted is what the order records.
    assert.equal(Number(order.pricing.subtotal), Number(quote.pricing.subtotal));
    assert.equal(Number(order.pricing.total), Number(quote.pricing.total));
    assert.equal(order.paymentMethod || order.payment?.method, 'cash');

    // And the columns behind that view agree with it.
    const row = await prisma.foodOrder.findUnique({ where: { id: order._id || order.id } });
    assert.equal(Number(row.subtotal), 500);
    assert.equal(Number(row.total), Number(order.pricing.total));
    assert.equal(row.restaurantId, restaurantId);
    assert.equal(row.userId, userId);
});

test('the order carries its items', async () => {
    const { order } = await createOrder(userId, cartOf(3));
    const id = order._id || order.id;
    created.orders.push(id);

    const items = await prisma.orderItem.findMany({ where: { orderId: id } });
    assert.equal(items.length, 1, 'one line for one dish');
    assert.equal(items[0].quantity, 3);
    assert.equal(Number(items[0].price), 250);
});

test('a cash order books its ledger row', async () => {
    const { order } = await createOrder(userId, cartOf(1));
    const id = order._id || order.id;
    created.orders.push(id);

    // The row every finance report and settlement reads.
    const tx = await prisma.foodTransaction.findUnique({ where: { orderId: id } });
    assert.ok(tx, 'a transaction is written for a cash order');
    assert.equal(Number(tx.totalCustomerPaid), Number(order.pricing.total));
    assert.equal(tx.paymentMethod, 'cash');
    assert.ok(Number(tx.restaurantShare) > 0, 'the restaurant is credited something');
});

test('the customer can read their order back', async () => {
    const { order } = await createOrder(userId, cartOf(1));
    const id = order._id || order.id;
    created.orders.push(id);

    const fetched = await getOrderById(id, { userId });
    assert.equal(fetched.orderId, order.orderId);
    assert.equal(Number(fetched.pricing.total), Number(order.pricing.total));

    const { data } = await listOrdersUser(userId, {});
    assert.ok(data.some((o) => (o._id || o.id) === id), 'it appears in their list');
});

test('cancelling refunds the right amount and blocks a second cancel', async () => {
    const { order } = await createOrder(userId, cartOf(2));
    const id = order._id || order.id;
    created.orders.push(id);

    const cancelled = await cancelOrder(id, userId, 'changed my mind');
    assert.match(String(cancelled.order?.orderStatus ?? cancelled.orderStatus), /cancelled/);

    const row = await prisma.foodOrder.findUnique({ where: { id } });
    assert.match(row.orderStatus, /^cancelled/);
    // A cash order was never charged, so there is nothing to refund.
    assert.equal(Number(row.refundAmount), 0);

    // Cancelling twice must not run the refund path again.
    await assert.rejects(() => cancelOrder(id, userId, 'again'), /within 1 minute of placing them/);
});

test('another customer cannot see or cancel this order', async () => {
    const { order } = await createOrder(userId, cartOf(1));
    const id = order._id || order.id;
    created.orders.push(id);

    const stranger = await prisma.foodUser.create({ data: { phone: uniquePhone('5') } });
    created.users.push(stranger.id);

    await assert.rejects(() => cancelOrder(id, stranger.id, 'not mine'), /not found/i);

    const { data } = await listOrdersUser(stranger.id, {});
    assert.ok(!data.some((o) => (o._id || o.id) === id), 'it is not in a stranger\'s list');
});

test('an order for a dish that is not on the menu is refused', async () => {
    // A well-formed id for a dish that does not exist — not a malformed key,
    // which would fail for the wrong reason and prove nothing.
    await assert.rejects(
        () => createOrder(userId, { ...cartOf(1), items: [{ itemId: 'a'.repeat(24), quantity: 1 }] }),
    );
    await assert.rejects(() => createOrder(userId, { ...cartOf(1), items: [] }));
    await assert.rejects(() => createOrder(userId, { ...cartOf(1), restaurantId: 'not-an-id' }));
});

// ---- zone: the restaurant's, never the app's ---------------------------------------

test('a client zoneId (even one that does not exist) neither fails the order nor changes its zone or price', async () => {
    const restaurant = await prisma.foodRestaurant.findUnique({ where: { id: restaurantId }, select: { zoneId: true } });
    const bogus = { ...cartOf(1), zoneId: 'f'.repeat(24) };
    const quote = await calculateOrder(userId, bogus);
    const { order } = await createOrder(userId, bogus);
    created.orders.push(order._id || order.id);
    const row = await prisma.foodOrder.findUnique({ where: { id: order._id || order.id } });
    assert.equal(row.zoneId, restaurant.zoneId);
    assert.equal(Number(order.pricing.total), Number(quote.pricing.total));
});

// ---- coupons: one use per order, given back on cancel --------------------------------

const makeCoupon = async (data = {}) => {
    created.offers = created.offers || [];
    const offer = await prisma.foodOffer.create({
        data: { couponCode: uniqueTag('QC').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), discountType: 'flat_price', discountValue: 50, ...data },
    });
    created.offers.push(offer.id);
    return offer;
};

test('cancelling an order gives the coupon use back (user and restaurant cancel)', async () => {
    const offer = await makeCoupon({ usageLimit: 5, perUserLimit: 1 });
    const withCoupon = { ...cartOf(1), pricing: { couponCode: offer.couponCode } };

    const { order } = await createOrder(userId, withCoupon);
    created.orders.push(order._id || order.id);
    assert.equal((await prisma.foodOffer.findUnique({ where: { id: offer.id } })).usedCount, 1);
    await assert.rejects(() => createOrder(userId, withCoupon), /maximum|used/i, 'per-user limit 1 holds');

    await cancelOrder(order._id || order.id, userId, 'changed my mind');
    assert.equal((await prisma.foodOffer.findUnique({ where: { id: offer.id } })).usedCount, 0);
    const usage = await prisma.foodOfferUsage.findFirst({ where: { offerId: offer.id, userId } });
    assert.equal(usage.count, 0);

    const { order: again } = await createOrder(userId, withCoupon);
    created.orders.push(again._id || again.id);
    await prisma.foodOrder.update({ where: { id: again._id || again.id }, data: { acceptanceDeadlineAt: null } });
    await updateOrderStatusRestaurant(again._id || again.id, restaurantId, 'cancelled_by_restaurant', 'Out of paneer');
    assert.equal((await prisma.foodOffer.findUnique({ where: { id: offer.id } })).usedCount, 0);

    // The rejection reason reaches the customer's inbox, not only the push.
    let rows = [];
    for (let i = 0; i < 20 && !rows.length; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        rows = await prisma.foodNotification.findMany({
            where: { ownerType: 'USER', ownerId: userId, message: 'Out of paneer' },
        });
    }
    assert.equal(rows.length, 1);
});

test('two orders racing for the last use of a limit-1 coupon: only one goes through', async () => {
    const offer = await makeCoupon({ usageLimit: 1 });
    const other = await prisma.foodUser.create({ data: { name: `${tag} Racer`, phone: uniquePhone('5') } });
    created.users.push(other.id);
    const results = await Promise.allSettled([userId, other.id].map((uid) =>
        createOrder(uid, { ...cartOf(1), pricing: { couponCode: offer.couponCode } })));
    for (const r of results) if (r.status === 'fulfilled') created.orders.push(r.value.order._id || r.value.order.id);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await prisma.foodOffer.findUnique({ where: { id: offer.id } })).usedCount, 1);
});
