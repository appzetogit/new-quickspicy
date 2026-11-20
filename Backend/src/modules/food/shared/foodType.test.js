import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../utils/testIds.js';
import { foodTypeWhereFromQuery, fromFoodTypeColumn, isEggFoodType, isVegFoodType, toFoodTypeColumn } from './foodType.util.js';
import { categoryAllowsFoodType } from './categoryWorkflow.js';
import { createFood, updateFood } from '../admin/services/adminFood.service.js';
import { getPublicApprovedRestaurantMenu } from '../restaurant/services/restaurantMenu.service.js';
import { normalizeFoodTypeForCategory } from './categoryWorkflow.js';
import { updateRestaurantById } from '../admin/services/adminRestaurantWrite.service.js';

/**
 * A dish's diet mark: "veg" in any spelling is Veg. An exact 'Veg' match
 * stored the bulk-upload template's own "veg" as Non-Veg.
 */
test('veg in any case or spacing is Veg; anything else is Non-Veg', () => {
    for (const v of ['Veg', 'veg', 'VEG', ' Pure Veg ', 'pureveg', 'vegetarian']) {
        assert.equal(isVegFoodType(v), true, v);
        assert.equal(toFoodTypeColumn(v), 'Veg', v);
        assert.equal(fromFoodTypeColumn(v), 'Veg', v);
        assert.equal(normalizeFoodTypeForCategory(v), 'Veg', v);
    }
    for (const v of ['Non-Veg', 'nonveg', 'NonVeg', '', null, undefined, 'chicken']) {
        assert.equal(toFoodTypeColumn(v), 'NonVeg', String(v));
        assert.equal(fromFoodTypeColumn(v), 'Non-Veg', String(v));
    }
});

test('Egg is its own diet, and is not veg', () => {
    for (const v of ['Egg', 'egg', ' EGG ', 'Eggetarian', 'contains egg']) {
        assert.equal(isEggFoodType(v), true, v);
        assert.equal(isVegFoodType(v), false, v);
        assert.equal(toFoodTypeColumn(v), 'Egg', v);
        assert.equal(fromFoodTypeColumn(v), 'Egg', v);
        // Category scope: Egg counts as non-veg.
        assert.equal(normalizeFoodTypeForCategory(v), 'Non-Veg', v);
    }
    assert.equal(categoryAllowsFoodType('Veg', 'Egg'), false);
    assert.equal(categoryAllowsFoodType('Non-Veg', 'Egg'), true);
    assert.equal(categoryAllowsFoodType('Both', 'Egg'), true);
});

test('foodType / isVeg query filters', () => {
    assert.equal(foodTypeWhereFromQuery({}), null);
    assert.deepEqual(foodTypeWhereFromQuery({ isVeg: 'true' }), { foodType: { in: ['Veg'] } });
    assert.deepEqual(foodTypeWhereFromQuery({ foodType: 'Egg' }), { foodType: { in: ['Egg'] } });
    assert.deepEqual(foodTypeWhereFromQuery({ foodType: 'Veg,Egg' }), { foodType: { in: ['Veg', 'Egg'] } });
    assert.deepEqual(foodTypeWhereFromQuery({ foodType: 'Non-Veg' }), { foodType: { in: ['NonVeg'] } });
    assert.deepEqual(foodTypeWhereFromQuery({ foodType: 'Egg', isVeg: 'true' }), { foodType: { in: [] } });
    assert.equal(foodTypeWhereFromQuery({ foodType: 'bogus' }), null);
});

const created = { restaurants: [], foods: [] };
test.after(async () => {
    await prisma.foodItem.deleteMany({ where: { id: { in: created.foods } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.$disconnect();
});

test('a restaurant with non-veg dishes cannot be switched to pure veg', async () => {
    const tag = uniqueTag('PV');
    const r = await prisma.foodRestaurant.create({
        data: { restaurantName: `${tag} Kitchen`, ownerName: 'O', ownerPhone: uniquePhone('9'), status: 'approved' },
    });
    created.restaurants.push(r.id);
    const dish = await prisma.foodItem.create({ data: { restaurantId: r.id, name: `${tag} Chicken`, price: 100, foodType: 'NonVeg' } });
    created.foods.push(dish.id);

    await assert.rejects(() => updateRestaurantById(r.id, { pureVegRestaurant: true }), /1 dish is marked Non-veg/);
    assert.equal((await prisma.foodRestaurant.findUnique({ where: { id: r.id } })).pureVegRestaurant, false);

    await prisma.foodItem.update({ where: { id: dish.id }, data: { foodType: 'Veg' } });
    await updateRestaurantById(r.id, { pureVegRestaurant: true });
    assert.equal((await prisma.foodRestaurant.findUnique({ where: { id: r.id } })).pureVegRestaurant, true);
});

test('an Egg dish blocks pure veg, and a pure veg restaurant refuses Egg dishes', async () => {
    const tag = uniqueTag('EG');
    const r = await prisma.foodRestaurant.create({
        data: { restaurantName: `${tag} Kitchen`, ownerName: 'O', ownerPhone: uniquePhone('9'), status: 'approved' },
    });
    created.restaurants.push(r.id);
    const omelette = await createFood({ restaurantId: r.id, name: `${tag} Omelette`, price: 80, foodType: 'Egg', categoryName: 'Breakfast' });
    created.foods.push(omelette.id);
    assert.equal(omelette.foodType, 'Egg');

    await assert.rejects(() => updateRestaurantById(r.id, { pureVegRestaurant: true }), /Non-veg or Egg/);

    await updateFood(omelette.id, { foodType: 'Veg' });
    await updateRestaurantById(r.id, { pureVegRestaurant: true });
    await assert.rejects(
        () => createFood({ restaurantId: r.id, name: `${tag} Egg Roll`, price: 90, foodType: 'Egg', categoryName: 'Breakfast' }),
        /Pure veg/,
    );
    await assert.rejects(() => updateFood(omelette.id, { foodType: 'Egg' }), /Pure veg/);
});

test('the public menu returns Egg and filters by foodType / isVeg', async () => {
    const tag = uniqueTag('EM');
    const r = await prisma.foodRestaurant.create({
        data: { restaurantName: `${tag} Kitchen`, ownerName: 'O', ownerPhone: uniquePhone('9'), status: 'approved' },
    });
    created.restaurants.push(r.id);
    for (const [name, foodType] of [['Paneer', 'Veg'], ['Omelette', 'Egg'], ['Chicken', 'NonVeg']]) {
        const f = await prisma.foodItem.create({
            data: { restaurantId: r.id, name: `${tag} ${name}`, price: 100, foodType, approvalStatus: 'approved' },
        });
        created.foods.push(f.id);
    }
    const types = (menu) => menu.sections.flatMap((s) => s.items.map((i) => i.foodType)).sort();

    assert.deepEqual(types(await getPublicApprovedRestaurantMenu(r.id)), ['Egg', 'NonVeg', 'Veg']);
    assert.deepEqual(types(await getPublicApprovedRestaurantMenu(r.id, { isVeg: 'true' })), ['Veg']);
    assert.deepEqual(types(await getPublicApprovedRestaurantMenu(r.id, { foodType: 'Egg' })), ['Egg']);
    assert.deepEqual(types(await getPublicApprovedRestaurantMenu(r.id, { foodType: 'Veg,Egg' })), ['Egg', 'Veg']);
});
