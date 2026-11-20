import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone } from '../../../../utils/testIds.js';
import { deriveRestaurantFields, fromRestaurantLocation } from '../../restaurant/restaurant.mapper.js';
import {
    syncUserCart,
    listUserCarts,
    getUserCart,
    getLatestUserCart,
    replaceUserCart,
    deleteUserCart,
    clearUserCarts,
    addUserCartItem,
    updateUserCartItem,
    removeUserCartItem,
    listUserCartsForAdmin,
} from './userCart.service.js';
import { shareCart, importSharedCart } from './sharedCart.service.js';

/**
 * Multiple carts (C5): one cart per (customer, restaurant). Seeding follows
 * search/services/phase2.test.js.
 */
const stamp = `${Date.now()}`;
const LAT = 15.7355;
const LNG = 79.2697;
const created = { restaurants: [], foods: [], users: [] };

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
    const user = await prisma.foodUser.create({ data: { phone: uniquePhone('7'), name: 'Multi Cart' } });
    created.users.push(user.id);
    return user;
};

const line = (food, restaurant, quantity = 1, price = Number(food.price)) => ({
    itemId: food.id, restaurantId: restaurant.id, name: food.name, price, quantity,
});

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test.after(async () => {
    await prisma.foodSharedCart.deleteMany({ where: { sharedByUserId: { in: created.users } } });
    await prisma.foodUserCart.deleteMany({ where: { userId: { in: created.users } } });
    await prisma.foodItem.deleteMany({ where: { id: { in: created.foods } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.foodUser.deleteMany({ where: { id: { in: created.users } } });
    await prisma.$disconnect();
});

test('multi cart: a second restaurant gets its own cart; the list is newest first', async () => {
    const user = await makeUser();
    const a = await makeRestaurant('Cart A');
    const b = await makeRestaurant('Cart B');
    const dosa = await makeFood(a, 'Qzmc Dosa', 60);
    const biryani = await makeFood(b, 'Qzmc Biryani', 250);

    await syncUserCart(user.id, [line(dosa, a, 2)]);
    await pause(10);
    await syncUserCart(user.id, [line(biryani, b, 1)]);

    const { carts, count, totalItems, latestRestaurantId } = await listUserCarts(user.id);
    assert.equal(count, 2);
    assert.equal(totalItems, 3);
    assert.deepEqual(carts.map((c) => c.restaurantId), [b.id, a.id], 'most recently updated first');
    assert.equal(latestRestaurantId, b.id);
    assert.equal(carts[1].itemCount, 2);
    assert.equal(carts[1].subtotal, 120);
    assert.equal(carts[1].restaurantName, a.restaurantName, 'name filled in from the restaurant');
    assert.equal(carts[1].restaurant.id, a.id);
    assert.equal(carts[1].restaurantAvailable, true);
    assert.equal(carts[1].items[0].lineItemId, `${dosa.id}::base`);
});

test('multi cart: checking out one cart (deleting it) leaves the other intact', async () => {
    const user = await makeUser();
    const a = await makeRestaurant('Checkout A');
    const b = await makeRestaurant('Checkout B');
    const idli = await makeFood(a, 'Qzmc Idli', 40);
    const naan = await makeFood(b, 'Qzmc Naan', 30);
    await syncUserCart(user.id, [line(idli, a, 1)]);
    await syncUserCart(user.id, [line(naan, b, 3)]);

    // The web app empties the checked-out cart by restaurant.
    await replaceUserCart(user.id, a.id, []);
    assert.equal((await getUserCart(user.id, a.id)).cart, null);
    assert.equal((await getUserCart(user.id, b.id)).cart.itemCount, 3);

    assert.deepEqual(await deleteUserCart(user.id, b.id), { deleted: true, restaurantId: b.id });
    assert.equal((await listUserCarts(user.id)).count, 0);
});

test('legacy PUT /cart: items go to their own restaurant; an empty sync deletes only the latest cart', async () => {
    const user = await makeUser();
    const a = await makeRestaurant('Legacy A');
    const b = await makeRestaurant('Legacy B');
    const vada = await makeFood(a, 'Qzmc Vada', 25);
    const roll = await makeFood(b, 'Qzmc Roll', 90);

    await syncUserCart(user.id, [line(vada, a, 4)]);
    await pause(10);
    // The old app's "replace cart" flow: it now syncs only restaurant B's items.
    await syncUserCart(user.id, [line(roll, b, 1)]);
    assert.equal((await getUserCart(user.id, a.id)).cart.itemCount, 4, 'cart A was not overwritten');

    // GET /cart returns the most recently changed cart.
    assert.equal((await getLatestUserCart(user.id)).cart.restaurantId, b.id);
    assert.equal((await getLatestUserCart(user.id, a.id)).cart.restaurantId, a.id);

    // After an order the old app syncs an empty cart without a restaurant.
    await syncUserCart(user.id, [], null);
    assert.equal((await getUserCart(user.id, b.id)).cart, null, 'latest (B) emptied');
    assert.equal((await getUserCart(user.id, a.id)).cart.itemCount, 4, 'A kept');

    // With a restaurant named, that one is emptied.
    await syncUserCart(user.id, [], null, { restaurantId: a.id });
    assert.equal((await listUserCarts(user.id)).count, 0);
});

test('legacy PUT /cart with dishes from two restaurants splits them, never mixes them', async () => {
    const user = await makeUser();
    const a = await makeRestaurant('Split A');
    const b = await makeRestaurant('Split B');
    const one = await makeFood(a, 'Qzmc One', 10);
    const two = await makeFood(b, 'Qzmc Two', 20);
    await syncUserCart(user.id, [line(one, a, 1), line(two, b, 2)]);
    assert.equal((await getUserCart(user.id, a.id)).cart.itemCount, 1);
    assert.equal((await getUserCart(user.id, b.id)).cart.itemCount, 2);

    // A named cart refuses another restaurant's dish.
    await replaceUserCart(user.id, a.id, [line(one, a, 3), line(two, b, 5)]);
    const cartA = (await getUserCart(user.id, a.id)).cart;
    assert.deepEqual(cartA.items.map((i) => [i.itemId, i.quantity]), [[one.id, 3]]);
});

test('item endpoints: server prices, increments, set quantity, remove, empty deletes the cart', async () => {
    const user = await makeUser();
    const a = await makeRestaurant('Items A');
    const b = await makeRestaurant('Items B');
    const thali = await makeFood(a, 'Qzmc Thali', 150);
    const sized = await makeFood(a, 'Qzmc Pizza', 200, {
        variants: { create: [{ name: 'Small', price: 199 }, { name: 'Large', price: 349 }] },
    });
    const large = await prisma.foodItemVariant.findFirst({ where: { foodItemId: sized.id, name: 'Large' } });
    const elsewhere = await makeFood(b, 'Qzmc Elsewhere', 99);

    let { cart } = await addUserCartItem(user.id, a.id, { itemId: thali.id, price: 1 });
    assert.equal(cart.items[0].price, 150, 'price from the menu, not the client');
    ({ cart } = await addUserCartItem(user.id, a.id, { itemId: thali.id, quantity: 2 }));
    assert.equal(cart.items[0].quantity, 3);

    await assert.rejects(() => addUserCartItem(user.id, a.id, { itemId: sized.id }), /Choose an option/);
    ({ cart } = await addUserCartItem(user.id, a.id, { itemId: sized.id, variantId: large.id }));
    const pizza = cart.items.find((i) => i.itemId === sized.id);
    assert.equal(pizza.price, 349);
    assert.equal(pizza.variantName, 'Large');
    assert.equal(pizza.lineItemId, `${sized.id}::${large.id}`);
    assert.equal(cart.itemCount, 4);
    assert.equal(cart.subtotal, 150 * 3 + 349);

    await assert.rejects(() => addUserCartItem(user.id, a.id, { itemId: elsewhere.id }), /not found at this restaurant/);
    await assert.rejects(() => addUserCartItem(user.id, a.id, { itemId: thali.id, quantity: 0 }), /Quantity/);

    ({ cart } = await updateUserCartItem(user.id, a.id, thali.id, { quantity: 1 }));
    assert.equal(cart.items.find((i) => i.itemId === thali.id).quantity, 1);
    await assert.rejects(() => updateUserCartItem(user.id, a.id, sized.id, { quantity: 2 }), /not in this cart/,
        'a variant line needs its variantId');

    ({ cart } = await removeUserCartItem(user.id, a.id, sized.id, large.id));
    assert.deepEqual(cart.items.map((i) => i.itemId), [thali.id]);
    ({ cart } = await updateUserCartItem(user.id, a.id, thali.id, { quantity: 0 }));
    assert.equal(cart, null, 'last line removed deletes the cart');
    assert.equal(await prisma.foodUserCart.count({ where: { userId: user.id } }), 0);

    // Concurrent adds are serialised by the row lock.
    await Promise.all([1, 2, 3, 4, 5].map(() => addUserCartItem(user.id, a.id, { itemId: thali.id })));
    assert.equal((await getUserCart(user.id, a.id)).cart.items[0].quantity, 5);
});

test('clear all, share a chosen cart, and import replaces only that restaurant\'s cart', async () => {
    const sender = await makeUser();
    const receiver = await makeUser();
    const a = await makeRestaurant('Share MC A');
    const b = await makeRestaurant('Share MC B');
    const soup = await makeFood(a, 'Qzmc Soup', 70);
    const cake = await makeFood(b, 'Qzmc Cake', 120);

    await syncUserCart(sender.id, [line(soup, a, 2)]);
    await pause(10);
    await syncUserCart(sender.id, [line(cake, b, 1)]);
    const link = await shareCart(sender.id, a.id);
    assert.equal(link.itemCount, 2, 'the named cart, not the latest');
    assert.equal((await shareCart(sender.id)).itemCount, 1, 'no restaurant: the latest cart');

    await syncUserCart(receiver.id, [line(cake, b, 4)]);
    const imported = await importSharedCart(receiver.id, link.token);
    assert.equal(imported.cart.restaurantId, a.id);
    assert.equal((await getUserCart(receiver.id, b.id)).cart.itemCount, 4, 'other restaurant cart untouched');
    assert.equal((await listUserCarts(receiver.id)).count, 2);

    // The admin list shows one row per cart.
    const admin = await listUserCartsForAdmin({ search: receiver.phone, limit: 10 });
    assert.equal(admin.carts.filter((c) => c.userId === receiver.id).length, 2);

    assert.deepEqual(await clearUserCarts(receiver.id), { deleted: 2 });
    assert.equal((await listUserCarts(receiver.id)).count, 0);
});
