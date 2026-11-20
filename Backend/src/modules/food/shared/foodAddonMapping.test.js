import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../utils/testIds.js';
import { getFoodAddonMapping, setFoodAddons } from './foodAddonMapping.service.js';

/**
 * Add-ons picked from the dish's side. FoodAddon.foodIds stays the only
 * record, and "empty foodIds = whole menu" must never be produced or narrowed
 * by accident.
 */
const created = { restaurants: [] };
let rid;
let otherRid;
let dish;
let otherDish;

const makeRestaurant = async () => {
    const r = await prisma.foodRestaurant.create({
        data: { restaurantName: `Map ${uniqueTag('R')}`, ownerName: 'O', ownerPhone: uniquePhone('9'), status: 'approved' },
    });
    created.restaurants.push(r.id);
    return r.id;
};

const makeAddon = (restaurantId, name, foodIds, extra = {}) =>
    prisma.foodAddon.create({
        data: {
            restaurantId,
            foodIds,
            draft: { name, price: 20, foodType: 'veg' },
            published: { name, price: 20, foodType: 'veg' },
            approvalStatus: 'approved',
            ...extra,
        },
    });

const foodIdsOf = async (id) => (await prisma.foodAddon.findUnique({ where: { id } })).foodIds;

test.before(async () => {
    rid = await makeRestaurant();
    otherRid = await makeRestaurant();
    dish = await prisma.foodItem.create({ data: { restaurantId: rid, name: `Dish ${uniqueTag('F')}`, price: 100 } });
    otherDish = await prisma.foodItem.create({ data: { restaurantId: rid, name: `Dish ${uniqueTag('F')}`, price: 120 } });
});

test.after(async () => {
    await prisma.foodAddon.deleteMany({ where: { restaurantId: { in: created.restaurants } } });
    await prisma.foodItem.deleteMany({ where: { restaurantId: { in: created.restaurants } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.$disconnect();
});

test('adds and removes the dish on item-specific add-ons only', async () => {
    const cheese = await makeAddon(rid, 'Cheese', [otherDish.id]);
    const sauce = await makeAddon(rid, 'Sauce', [dish.id, otherDish.id]);
    const wholeMenu = await makeAddon(rid, 'Napkins', []);
    const pending = await makeAddon(rid, 'Pending', [dish.id], { published: undefined, approvalStatus: 'pending' });

    const before = await getFoodAddonMapping(dish.id);
    const ids = before.addons.map((a) => a.id);
    assert.ok(ids.includes(cheese.id) && ids.includes(sauce.id) && ids.includes(wholeMenu.id));
    assert.ok(!ids.includes(pending.id), 'never-approved add-ons are not offered');
    assert.equal(before.addons.find((a) => a.id === wholeMenu.id).appliesToWholeMenu, true);

    // Cheese on, Sauce off; the whole-menu one sent or not changes nothing.
    const after = await setFoodAddons(dish.id, [cheese.id, wholeMenu.id]);
    assert.deepEqual(after.added, [cheese.id]);
    assert.deepEqual(after.removed, [sauce.id]);
    assert.deepEqual((await foodIdsOf(cheese.id)).sort(), [dish.id, otherDish.id].sort());
    assert.deepEqual(await foodIdsOf(sauce.id), [otherDish.id]);
    assert.deepEqual(await foodIdsOf(wholeMenu.id), []);
    // The pending add-on is left exactly as it was.
    assert.deepEqual(await foodIdsOf(pending.id), [dish.id]);
});

test('refuses to leave an add-on with no dish (that would mean whole menu)', async () => {
    const only = await makeAddon(rid, `Only ${uniqueTag('A')}`, [dish.id]);
    const current = (await getFoodAddonMapping(dish.id)).addonIds.filter((id) => id !== only.id);
    await assert.rejects(() => setFoodAddons(dish.id, current), /only item on add-on/);
    assert.deepEqual(await foodIdsOf(only.id), [dish.id]);
});

test('a restaurant can only map its own dish to its own add-ons', async () => {
    const foreign = await makeAddon(otherRid, 'Foreign', [otherDish.id]);
    await assert.rejects(() => setFoodAddons(dish.id, [foreign.id], { restaurantId: rid }), /do not belong/);
    assert.equal(await getFoodAddonMapping(dish.id, { restaurantId: otherRid }), null);
    assert.equal(await setFoodAddons(dish.id, [], { restaurantId: otherRid }), null);
    await assert.rejects(() => setFoodAddons(dish.id, 'nope'), /addonIds must be an array/);
});
