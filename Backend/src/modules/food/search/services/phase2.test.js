import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone } from '../../../../utils/testIds.js';
import { withOpenStatus, CLOSING_SOON_MINUTES } from '../../restaurant/helpers/restaurantAvailability.helper.js';
import { deriveRestaurantFields, fromRestaurantLocation } from '../../restaurant/restaurant.mapper.js';
import { searchDishes, suggest } from './dishSearch.service.js';
import { getOrderAgain } from '../../user/services/orderAgain.service.js';
import { shareCart, previewSharedCart, importSharedCart } from '../../user/services/sharedCart.service.js';
import { syncUserCart } from '../../user/services/userCart.service.js';
import { linkOutlets, unlinkOutlet, getOtherOutlets } from '../../restaurant/services/outlets.service.js';
import { getVideoFeed } from '../../restaurant/services/videoFeed.service.js';
import { listApprovedRestaurants } from '../../restaurant/services/restaurant.service.js';

/**
 * Phase 2: customer discovery and cart features. Restaurants are placed at a
 * real point with a delivery radius so they are "in reach" of the customer,
 * which is what every one of these endpoints filters on first.
 */
const stamp = `${Date.now()}`;
const LAT = 15.7355;
const LNG = 79.2697;
const at = { lat: String(LAT), lng: String(LNG) };
const created = { restaurants: [], foods: [], users: [], orders: [], shared: [] };

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
    const user = await prisma.foodUser.create({ data: { phone: uniquePhone('7'), name: 'Ravi Kumar' } });
    created.users.push(user.id);
    return user;
};

test.after(async () => {
    await prisma.foodSharedCart.deleteMany({ where: { sharedByUserId: { in: created.users } } });
    await prisma.foodUserCart.deleteMany({ where: { userId: { in: created.users } } });
    await prisma.foodOrder.deleteMany({ where: { id: { in: created.orders } } });
    await prisma.foodItem.deleteMany({ where: { id: { in: created.foods } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.foodUser.deleteMany({ where: { id: { in: created.users } } });
    await prisma.$disconnect();
});

// ----- Closing soon -----

const ist = (time) => new Date(`2026-11-18T${time}:00+05:30`);
const hours = (openingTime, closingTime) => ({ isAcceptingOrders: true, openingTime, closingTime, openDays: [] });

test('closing soon: within the threshold of the end of today\'s hours', () => {
    const near = withOpenStatus(hours('09:00', '22:00'), ist('21:45'));
    assert.equal(near.isOpenNow, true);
    assert.equal(near.closesInMinutes, 15);
    assert.equal(near.closingSoon, true);
    assert.equal(near.closingSoonThresholdMinutes, CLOSING_SOON_MINUTES);

    const far = withOpenStatus(hours('09:00', '22:00'), ist('20:00'));
    assert.equal(far.closesInMinutes, 120);
    assert.equal(far.closingSoon, false);
});

test('closing soon counts past midnight for overnight hours, and never for closed or all-day', () => {
    const lateNight = withOpenStatus(hours('18:00', '02:00'), ist('01:40'));
    assert.equal(lateNight.isOpenNow, true);
    assert.equal(lateNight.closesInMinutes, 20);
    assert.equal(lateNight.closingSoon, true);

    const evening = withOpenStatus(hours('18:00', '02:00'), ist('23:00'));
    assert.equal(evening.closesInMinutes, 180, 'counts through midnight');

    const closed = withOpenStatus(hours('09:00', '22:00'), ist('23:00'));
    assert.equal(closed.isOpenNow, false);
    assert.equal(closed.closingSoon, false);
    assert.equal(closed.closesInMinutes, null);

    const allDay = withOpenStatus(hours('00:00', '00:00'), ist('23:55'));
    assert.equal(allDay.closesInMinutes, null);
    assert.equal(allDay.closingSoon, false);

    const switchedOff = withOpenStatus({ ...hours('09:00', '22:00'), isAcceptingOrders: false }, ist('21:50'));
    assert.equal(switchedOff.closingSoon, false, 'an offline restaurant is not "closing soon"');
});

// ----- Dish search, suggestions, openOnly -----

test('dish search: every matching dish, at its price, sortable and filterable', async () => {
    const a = await makeRestaurant('Dish Search A');
    const b = await makeRestaurant('Dish Search B');
    const cheap = await makeFood(a, 'Qzbiryani Plain', 120);
    const dear = await makeFood(b, 'Qzbiryani Royal', 340);
    const veg = await makeFood(b, 'Qzbiryani Veg', 150, { foodType: 'Veg' });
    await makeFood(a, 'Qzbiryani Hidden', 99, { isAvailable: false });

    const all = await searchDishes({ q: 'qzbiryani', ...at });
    const ids = all.items.map((i) => i.id);
    assert.deepEqual(new Set(ids), new Set([cheap.id, dear.id, veg.id]), 'one entry per dish, unavailable left out');
    assert.ok(all.items[0].restaurant?.name, 'each dish carries its restaurant');

    const low = await searchDishes({ q: 'qzbiryani', ...at, sortBy: 'price-low' });
    assert.deepEqual(low.items.map((i) => i.price), [120, 150, 340]);
    const high = await searchDishes({ q: 'qzbiryani', ...at, sortBy: 'price-high' });
    assert.equal(high.items[0].id, dear.id);

    const capped = await searchDishes({ q: 'qzbiryani', ...at, maxPrice: '200' });
    assert.ok(capped.items.every((i) => i.price <= 200) && capped.total === 2);
    const vegOnly = await searchDishes({ q: 'qzbiryani', ...at, isVeg: 'true' });
    assert.deepEqual(vegOnly.items.map((i) => i.id), [veg.id]);

    assert.equal((await searchDishes({ q: 'q', ...at })).minChars, 2);
    assert.equal((await searchDishes({ q: 'qzbiryani' })).requiresLocation, true);
});

test('dish search openOnly hides dishes from restaurants that are offline', async () => {
    const off = await makeRestaurant('Dish Offline', { isAcceptingOrders: false });
    const dish = await makeFood(off, 'Qzoffline Curry', 200);
    const shown = await searchDishes({ q: 'qzoffline', ...at });
    assert.deepEqual(shown.items.map((i) => i.id), [dish.id], 'listed by default');
    assert.equal(shown.items[0].restaurant.isOpenNow, false);
    assert.equal((await searchDishes({ q: 'qzoffline', ...at, openOnly: 'true' })).total, 0);

    const list = await listApprovedRestaurants({ ...at, limit: '1000', openOnly: 'true' });
    assert.ok(!list.restaurants.some((r) => r.id === off.id), 'restaurant list openOnly too');
});

test('suggestions start at the third character', async () => {
    const r = await makeRestaurant('Suggest Spot');
    await makeFood(r, 'Qzpaneer Tikka', 220);
    await makeFood(r, 'Qzpaneer Butter', 240);

    const two = await suggest({ q: 'qz', ...at });
    assert.equal(two.minChars, 3);
    assert.deepEqual(two.dishes, []);

    const three = await suggest({ q: 'qzp', ...at });
    assert.ok(three.dishes.length >= 2);
    assert.ok(three.dishes.every((d) => d.nameEn.toLowerCase().includes('qzp')));
    const rs = await suggest({ q: `suggest spot ${stamp}`, ...at });
    assert.equal(rs.restaurants[0].id, r.id);
});

// ----- Order again -----

test('order again: past delivered dishes still on sale, most ordered first', async () => {
    const user = await makeUser();
    const r = await makeRestaurant('Order Again');
    const fav = await makeFood(r, 'Qzfav Dosa', 90);
    const once = await makeFood(r, 'Qzonce Idli', 60);
    const gone = await makeFood(r, 'Qzgone Vada', 40);

    const order = async (foods, orderStatus = 'delivered') => {
        const row = await prisma.foodOrder.create({
            data: {
                userId: user.id, restaurantId: r.id, orderStatus, paymentMethod: 'cash',
                addrStreet: '1 Test Street', addrCity: 'Markapuram', addrState: 'AP', subtotal: 100, total: 100,
                items: { create: foods.map((f) => ({ itemId: f.id, name: f.name, price: 1, quantity: 1 })) },
            },
        });
        created.orders.push(row.id);
    };
    await order([fav, once, gone]);
    await order([fav]);
    await order([once], 'cancelled_by_user');
    await prisma.foodItem.update({ where: { id: gone.id }, data: { isAvailable: false } });

    const out = await getOrderAgain(user.id, at);
    assert.deepEqual(out.items.map((i) => i.id), [fav.id, once.id], 'unavailable dish left out; cancelled order not counted');
    assert.equal(out.items[0].timesOrdered, 2);
    assert.equal(out.items[0].price, 90, 'today\'s price');
    assert.equal(out.restaurants[0].id, r.id);
    assert.equal(out.restaurants[0].ordersCount, 2);

    const stranger = await makeUser();
    assert.deepEqual(await getOrderAgain(stranger.id, at), { items: [], restaurants: [] });
});

// ----- Share cart -----

test('share cart: a link with today\'s prices, unavailable dishes marked, import replaces the cart', async () => {
    const sender = await makeUser();
    const receiver = await makeUser();
    const r = await makeRestaurant('Share Cart');
    const curry = await makeFood(r, 'Qzshare Curry', 200);
    const rice = await makeFood(r, 'Qzshare Rice', 80);

    await assert.rejects(() => shareCart(sender.id), /cart is empty/);
    await syncUserCart(sender.id, [
        { itemId: curry.id, restaurantId: r.id, name: curry.name, price: 200, quantity: 2 },
        { itemId: rice.id, restaurantId: r.id, name: rice.name, price: 80, quantity: 1 },
    ]);
    const link = await shareCart(sender.id);
    assert.match(link.token, /^[A-Za-z0-9_-]{16}$/);
    assert.ok(link.shareUrl.endsWith(link.token));

    // After sharing: the price goes up and the rice runs out.
    await prisma.foodItem.update({ where: { id: curry.id }, data: { price: 220 } });
    await prisma.foodItem.update({ where: { id: rice.id }, data: { isAvailable: false } });

    const preview = await previewSharedCart(link.token);
    assert.equal(preview.sharedBy, 'Ravi', 'first name only');
    assert.equal(preview.availableCount, 1);
    assert.equal(preview.unavailableCount, 1);
    assert.equal(preview.items.find((i) => i.itemId === curry.id).price, 220, 'priced now, not when shared');
    assert.equal(preview.subtotal, 440);

    await syncUserCart(receiver.id, [{ itemId: rice.id, restaurantId: r.id, name: 'old', price: 1, quantity: 9 }]);
    const imported = await importSharedCart(receiver.id, link.token);
    assert.equal(imported.added, 1);
    assert.deepEqual(imported.skipped, [rice.name]);
    const cart = await prisma.foodUserCart.findFirst({ where: { userId: receiver.id, restaurantId: r.id } });
    assert.deepEqual(cart.items.map((i) => [i.itemId, i.quantity, i.price]), [[curry.id, 2, 220]], 'replaced, not merged');
    assert.equal((await prisma.foodSharedCart.findUnique({ where: { token: link.token } })).importCount, 1);
});

test('share cart: expired and made-up links are refused', async () => {
    const user = await makeUser();
    const r = await makeRestaurant('Share Expired');
    const dish = await makeFood(r, 'Qzexp Dish', 50);
    await syncUserCart(user.id, [{ itemId: dish.id, restaurantId: r.id, name: dish.name, price: 50, quantity: 1 }]);
    const link = await shareCart(user.id);
    await prisma.foodSharedCart.update({ where: { token: link.token }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await assert.rejects(() => previewSharedCart(link.token), /expired/);
    await assert.rejects(() => previewSharedCart('nope'), /not found/);
    await assert.rejects(() => previewSharedCart("x'; drop table--"), /not found/);
});

// ----- Outlets -----

test('outlets: linking, the other outlets list, and unlinking dissolves a pair', async () => {
    const one = await makeRestaurant('Outlet One');
    const two = await makeRestaurant('Outlet Two');
    const three = await makeRestaurant('Outlet Three');

    assert.deepEqual((await getOtherOutlets(one.id, at)).outlets, [], 'standalone: none');
    const linked = await linkOutlets(one.id, { outletIds: [two.id, three.id] });
    assert.equal(linked.outletGroupId, one.id);
    assert.equal(linked.outlets.length, 3);

    const others = await getOtherOutlets(two.id, at);
    assert.deepEqual(new Set(others.outlets.map((o) => o.id)), new Set([one.id, three.id]));
    assert.ok(others.outlets.every((o) => o.inReach === true));

    const list = await listApprovedRestaurants({ ...at, limit: '1000' });
    assert.equal(list.restaurants.find((r) => r.id === one.id).outletCount, 2);

    await unlinkOutlet(three.id);
    assert.equal((await getOtherOutlets(one.id, at)).outlets.length, 1);
    await unlinkOutlet(two.id);
    const after = await prisma.foodRestaurant.findUnique({ where: { id: one.id } });
    assert.equal(after.outletGroupId, null, 'a group of one is dissolved');
    await assert.rejects(() => linkOutlets(one.id, { outletIds: [one.id] }), /at least one other/);
});

// ----- Video feed -----

test('video feed: dish videos in reach, restaurants you ordered from first', async () => {
    const user = await makeUser();
    const usual = await makeRestaurant('Video Usual');
    const fresh = await makeRestaurant('Video Fresh');
    const v1 = await makeFood(fresh, 'Qzvid Fresh', 100, { videoUrl: 'food/videos/fresh.mp4' });
    const v2 = await makeFood(usual, 'Qzvid Usual', 100, { videoUrl: 'food/videos/usual.mp4' });
    await makeFood(usual, 'Qzvid None', 100);
    const row = await prisma.foodOrder.create({
        data: {
            userId: user.id, restaurantId: usual.id, orderStatus: 'delivered', paymentMethod: 'cash',
            addrStreet: '1 Test Street', addrCity: 'Markapuram', addrState: 'AP', subtotal: 100, total: 100,
        },
    });
    created.orders.push(row.id);

    const mine = (feed) => feed.items.filter((i) => [v1.id, v2.id].includes(i.dishId));
    const forUser = mine(await getVideoFeed({ ...at, limit: '30' }, user.id));
    assert.equal(forUser.length, 2, 'only dishes with a video');
    assert.equal(forUser[0].dishId, v2.id, 'ordered-from restaurant first');
    assert.equal(forUser[0].forYou, true);

    const anonymous = await getVideoFeed({ ...at, limit: '30' });
    assert.ok(mine(anonymous).every((i) => i.forYou === false));
    assert.equal((await getVideoFeed({})).requiresLocation, true);
});
