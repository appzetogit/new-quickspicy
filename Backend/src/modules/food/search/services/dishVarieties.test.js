import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone } from '../../../../utils/testIds.js';
import { deriveRestaurantFields, fromRestaurantLocation } from '../../restaurant/restaurant.mapper.js';
import { suggest, searchDishRestaurants, normalizeDishName } from './dishSearch.service.js';

/**
 * Search suggestions (client spec C2): "<q> — See all restaurants", dish
 * varieties grouped case/space-insensitively with restaurant counts, and the
 * restaurants-serving-<q> listing. Same seeding as phase2.test.js: restaurants
 * at a real point with a delivery radius so they are in reach.
 */
const stamp = `${Date.now()}`;
// A word unique to this run, so other data never matches.
const WORD = `Qv${stamp.slice(-6)}biryani`;
const LAT = 15.7355;
const LNG = 79.2697;
const at = { lat: String(LAT), lng: String(LNG) };
const created = { restaurants: [], foods: [] };

const makeRestaurant = async (name, overrides = {}, { lat = LAT + created.restaurants.length * 0.002 } = {}) => {
    const phone = uniquePhone('9');
    const row = await prisma.foodRestaurant.create({
        data: {
            restaurantName: `${name} ${stamp}`,
            ownerName: 'Owner',
            ownerPhone: phone,
            ...deriveRestaurantFields({ restaurantName: `${name} ${stamp}`, ownerPhone: phone }),
            ...fromRestaurantLocation({ latitude: lat, longitude: LNG, city: 'Markapuram', state: 'AP' }),
            deliveryRadiusKm: 10,
            isAcceptingOrders: true,
            openingTime: '00:00',
            closingTime: '00:00',
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
            restaurantId: restaurant.id, name, price,
            foodType: 'NonVeg', approvalStatus: 'approved', isAvailable: true, ...extra,
        },
    });
    created.foods.push(food.id);
    return food;
};

test.after(async () => {
    await prisma.foodItem.deleteMany({ where: { id: { in: created.foods } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.$disconnect();
});

let seeded;
const seed = async () => {
    if (seeded) return seeded;
    const a = await makeRestaurant('Variety A');
    const b = await makeRestaurant('Variety B');
    const closed = await makeRestaurant('Variety Closed', { isAcceptingOrders: false });
    const pending = await makeRestaurant('Variety Pending', { status: 'pending' });
    const far = await makeRestaurant('Variety Far', {}, { lat: LAT + 2 });
    const noMatch = await makeRestaurant('Variety NoMatch');

    await makeFood(a, `Chicken ${WORD}`, 250);
    await makeFood(b, `  chicken   ${WORD.toUpperCase()} `, 260); // same variety, other spelling
    await makeFood(a, `Veg ${WORD}`, 180, { foodType: 'Veg' });
    await makeFood(b, `Mutton ${WORD}`, 320, { isAvailable: false }); // out of stock
    await makeFood(b, `Egg ${WORD}`, 200, { approvalStatus: 'pending' }); // not approved
    await makeFood(closed, `Prawn ${WORD}`, 400);
    await makeFood(pending, `Fish ${WORD}`, 380);
    await makeFood(far, `Chicken ${WORD}`, 250);
    await makeFood(noMatch, 'Plain Rice', 90);
    seeded = { a, b, closed, pending, far, noMatch };
    return seeded;
};

test('normalizeDishName folds case and spaces', () => {
    assert.equal(normalizeDishName('  Chicken   BIRYANI '), 'chicken biryani');
    assert.equal(normalizeDishName(null), '');
});

test('suggest: see-all row and varieties grouped, with restaurant counts', async () => {
    const { a, b } = await seed();
    const res = await suggest({ q: WORD, ...at });

    assert.ok(res.seeAll, 'see-all row present');
    assert.equal(res.seeAll.query, WORD);
    assert.match(res.seeAll.label, /See all restaurants/);
    assert.equal(res.seeAll.restaurantCount, 2, 'only open, approved, in-reach restaurants with an available match');

    const names = res.varieties.map((v) => normalizeDishName(v.nameEn));
    assert.deepEqual(new Set(names), new Set([`chicken ${WORD.toLowerCase()}`, `veg ${WORD.toLowerCase()}`]));

    const chicken = res.varieties.find((v) => normalizeDishName(v.nameEn).startsWith('chicken'));
    assert.equal(chicken.restaurantCount, 2, 'both spellings grouped as one variety');
    assert.equal(chicken.itemCount, 2);
    assert.equal(chicken.foodType, 'Non-Veg');
    assert.equal(res.varieties.find((v) => v.nameEn.startsWith('Veg')).foodType, 'Veg');
    assert.equal(res.noResults, false);

    // Old fields stay for older app builds.
    assert.ok(Array.isArray(res.dishes) && Array.isArray(res.restaurants) && Array.isArray(res.categories));
    assert.ok(a && b);
});

test('suggest: openOnly=false also counts closed restaurants', async () => {
    await seed();
    const res = await suggest({ q: WORD, ...at, openOnly: 'false' });
    assert.equal(res.seeAll.restaurantCount, 3);
    assert.ok(res.varieties.some((v) => v.nameEn.startsWith('Prawn')));
});

test('suggest: no results, too short, and no location', async () => {
    await seed();
    const none = await suggest({ q: `${WORD}zzz`, ...at });
    assert.equal(none.seeAll, null);
    assert.deepEqual(none.varieties, []);
    assert.equal(none.noResults, true);

    const short = await suggest({ q: 'qv', ...at });
    assert.equal(short.minChars, 3);
    assert.equal(short.seeAll, null);
    assert.equal(short.noResults, false, 'too short is not "no results"');

    assert.equal((await suggest({ q: WORD })).requiresLocation, true);
});

test('restaurants serving a dish: only those with an available matching dish', async () => {
    const { a, b, closed, pending, far, noMatch } = await seed();
    const res = await searchDishRestaurants({ q: WORD, ...at });
    const ids = res.restaurants.map((r) => r.id);
    assert.deepEqual(new Set(ids), new Set([a.id, b.id]));
    for (const excluded of [closed, pending, far, noMatch]) assert.ok(!ids.includes(excluded.id));
    assert.equal(res.total, 2);

    const cardA = res.restaurants.find((r) => r.id === a.id);
    assert.equal(cardA.matchedDishCount, 2);
    assert.ok(cardA.matchedDishes.length >= 1 && cardA.matchedDishes[0].price > 0);
    assert.equal(cardA.matchType, 'food');
    assert.equal(cardA.isOpenNow, true);

    const cardB = res.restaurants.find((r) => r.id === b.id);
    assert.equal(cardB.matchedDishCount, 1, 'out of stock and unapproved dishes do not count');

    const withClosed = await searchDishRestaurants({ q: WORD, ...at, openOnly: 'false' });
    assert.ok(withClosed.restaurants.some((r) => r.id === closed.id));
    assert.equal(withClosed.restaurants.at(-1).id, closed.id, 'closed ones come last');
});

test('restaurants serving a dish: filters, exact variety, empty query', async () => {
    const { a } = await seed();
    const veg = await searchDishRestaurants({ q: WORD, ...at, isVeg: 'true' });
    assert.deepEqual(veg.restaurants.map((r) => r.id), [a.id]);

    const exact = await searchDishRestaurants({ q: `chicken ${WORD}`, ...at, exact: 'true' });
    assert.equal(exact.total, 2);
    const exactNone = await searchDishRestaurants({ q: 'chicken', ...at, exact: 'true' });
    assert.ok(!exactNone.restaurants.some((r) => created.restaurants.includes(r.id)));

    const blank = await searchDishRestaurants({ q: '   ', ...at });
    assert.equal(blank.total, 0);
    assert.equal(blank.minChars, 2);

    assert.equal((await searchDishRestaurants({ q: WORD })).requiresLocation, true);
});
