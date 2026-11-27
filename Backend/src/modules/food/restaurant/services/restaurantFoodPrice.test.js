import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../../utils/testIds.js';
import { createRestaurantFood } from './restaurantFood.service.js';

/** A dish costs more than 0 and at most the menu ceiling; 1e13 used to be a 500. */
let restaurantId;

test.before(async () => {
    const r = await prisma.foodRestaurant.create({
        data: { restaurantName: `${uniqueTag('Price')} Kitchen`, ownerName: 'O', ownerPhone: uniquePhone('9'), status: 'approved' },
    });
    restaurantId = r.id;
});

test.after(async () => {
    await prisma.foodRestaurant.deleteMany({ where: { id: restaurantId } });
    await prisma.$disconnect();
});

test('dish and variant prices must be above 0 and sane', async () => {
    const dish = (extra) => createRestaurantFood(restaurantId, { name: uniqueTag('Dish'), ...extra });
    await assert.rejects(() => dish({ price: 1e13 }), /cannot be more/);
    await assert.rejects(() => dish({ price: 0 }), /greater than 0/);
    await assert.rejects(() => dish({ price: '' }), /greater than 0/);
    await assert.rejects(() => dish({ price: 'Infinity' }), /greater than 0/);
    await assert.rejects(() => dish({ variants: [{ name: 'Half', price: 0 }] }), /greater than 0/);
    await assert.rejects(() => dish({ variants: [{ name: 'Half', price: 1e13 }] }), /cannot be more/);
});
