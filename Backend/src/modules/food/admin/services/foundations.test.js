import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone } from '../../../../utils/testIds.js';
import * as verticals from './adminVertical.service.js';
import * as cohorts from './adminRiderCohort.service.js';
import * as translations from './adminTranslation.service.js';
import { verticalFilterFromQuery } from '../../shared/verticals.js';
import { getPublicApprovedRestaurantMenu } from '../../restaurant/services/restaurantMenu.service.js';
import { updateCurrentUserProfile } from '../../user/services/userProfile.service.js';
import { validateUserProfileUpdateDto } from '../../../../dtos/food/userProfileUpdate.dto.js';
import { deriveRestaurantFields, fromRestaurantLocation } from '../../restaurant/restaurant.mapper.js';

/**
 * Phase 1 foundations: business verticals, rider cohorts and Telugu text.
 *
 * The migration seeds "Food" (the default) and "Home Food". Tests make their
 * own verticals with unique names and put the default back on "Food" when they
 * move it, so the seeded rows are left as they were.
 */
const stamp = `${Date.now()}`;
const created = { verticals: [], restaurants: [], cohorts: [], riders: [], zones: [], categories: [], foods: [], users: [] };

const makeRestaurant = async (overrides = {}) => {
    const row = await prisma.foodRestaurant.create({
        data: {
            restaurantName: `Vertical Test ${stamp} ${created.restaurants.length}`,
            ownerName: 'Owner',
            ownerPhone: uniquePhone('9'),
            status: 'approved',
            ...overrides,
        },
    });
    created.restaurants.push(row.id);
    return row;
};

const makeZone = async (name) => {
    const zone = await prisma.foodZone.create({
        data: {
            name: `${name} ${stamp}`,
            coordinates: [
                { latitude: 15.7, longitude: 79.2 },
                { latitude: 15.8, longitude: 79.2 },
                { latitude: 15.8, longitude: 79.3 },
            ],
        },
    });
    created.zones.push(zone.id);
    return zone;
};

const makeRider = async () => {
    const rider = await prisma.foodDeliveryPartner.create({
        data: { name: 'Cohort Rider', phone: uniquePhone('8'), status: 'approved' },
    });
    created.riders.push(rider.id);
    return rider;
};

const restaurantsIn = async (query) => {
    const pick = await verticalFilterFromQuery(query);
    if (pick.none) return null;
    const rows = await prisma.foodRestaurant.findMany({
        where: { id: { in: created.restaurants }, ...(pick.filter || {}) },
        select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
};

test.after(async () => {
    await prisma.foodItem.deleteMany({ where: { id: { in: created.foods } } });
    await prisma.foodCategory.deleteMany({ where: { id: { in: created.categories } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.foodDeliveryPartner.deleteMany({ where: { id: { in: created.riders } } });
    await prisma.foodRiderCohort.deleteMany({ where: { id: { in: created.cohorts } } });
    await prisma.foodZone.deleteMany({ where: { id: { in: created.zones } } });
    await prisma.foodUser.deleteMany({ where: { id: { in: created.users } } });
    // Default back on the seeded Food vertical before removing test verticals.
    await prisma.foodVertical.updateMany({ where: { isDefault: true, slug: { not: 'food' } }, data: { isDefault: false } });
    await prisma.foodVertical.updateMany({ where: { slug: 'food' }, data: { isDefault: true, isActive: true } });
    await prisma.foodVertical.deleteMany({ where: { id: { in: created.verticals } } });
    await prisma.$disconnect();
});

// ----- Verticals -----

test('the migration seeds Food as the one default vertical, and Home Food', async () => {
    const food = await prisma.foodVertical.findUnique({ where: { slug: 'food' } });
    const home = await prisma.foodVertical.findUnique({ where: { slug: 'home food' } });
    assert.ok(food?.isDefault, 'Food is the default');
    assert.ok(home && !home.isDefault);
    assert.equal(await prisma.foodVertical.count({ where: { isDefault: true } }), 1);
});

test('a vertical name is unique however it is spelled', async () => {
    const { vertical } = await verticals.createVertical({ name: `Grocery ${stamp}`, nameTe: 'కిరాణా' });
    created.verticals.push(vertical.id);
    await assert.rejects(() => verticals.createVertical({ name: `  grocery   ${stamp} ` }), /already exists/);
});

test('restaurants with no vertical count as Food; others only in their own', async () => {
    const food = await prisma.foodVertical.findUnique({ where: { slug: 'food' } });
    const { vertical: homeKitchen } = await verticals.createVertical({ name: `Home Kitchen ${stamp}` });
    created.verticals.push(homeKitchen.id);

    const plain = await makeRestaurant();
    const homeOnly = await makeRestaurant();
    const both = await makeRestaurant();
    await verticals.setRestaurantVerticals(homeOnly.id, { verticalIds: [homeKitchen.id] });
    await verticals.setRestaurantVerticals(both.id, { verticalIds: [homeKitchen.id, food.id] });

    const inFood = await restaurantsIn({ verticalId: food.id });
    assert.ok(inFood.has(plain.id), 'no vertical -> Food');
    assert.ok(inFood.has(both.id));
    assert.ok(!inFood.has(homeOnly.id));

    const inHome = await restaurantsIn({ vertical: `home kitchen ${stamp}` });
    assert.ok(inHome.has(homeOnly.id) && inHome.has(both.id));
    assert.ok(!inHome.has(plain.id));

    // No filter asked for: nothing is filtered out.
    assert.equal((await restaurantsIn({})).size, created.restaurants.length);
    // An unknown vertical is "no results", not "ignore the filter".
    assert.equal(await restaurantsIn({ vertical: `nope ${stamp}` }), null);
});

test('the search endpoint filters by vertical end to end', async () => {
    // The controller copies query parameters one by one, and one it does not
    // copy is silently ignored -- which is how this filter first shipped broken.
    // So this goes through the handler, with a restaurant that is really in
    // reach, and checks the vertical decides whether it is found.
    const { searchController } = await import('../../search/controllers/search.controller.js');
    const lat = 15.7355, lng = 79.2697;
    const name = `Zzq Search Vertical ${stamp}`;
    const phone = uniquePhone('9');
    const restaurant = await makeRestaurant({
        restaurantName: name,
        ownerPhone: phone,
        ...deriveRestaurantFields({ restaurantName: name, ownerPhone: phone }),
        ...fromRestaurantLocation({ latitude: lat, longitude: lng, city: 'Markapuram', state: 'Andhra Pradesh' }),
        deliveryRadiusKm: 10,
        isAcceptingOrders: true,
    });
    const { vertical } = await verticals.createVertical({ name: `Search Vertical ${stamp}` });
    created.verticals.push(vertical.id);

    const search = async (extra) => {
        const seen = [];
        const res = { status: () => res, json: (body) => seen.push(body) };
        await searchController({ query: { q: name, lat: String(lat), lng: String(lng), ...extra } }, res, (err) => { throw err; });
        return seen[0].data.restaurants.map((r) => r.id || r._id);
    };

    assert.ok((await search({})).includes(restaurant.id), 'found with no vertical asked for');
    assert.deepEqual(await search({ verticalId: vertical.id }), [], 'not in that vertical yet');
    assert.deepEqual(await search({ vertical: `no such vertical ${stamp}` }), [], 'unknown vertical: nothing');
    await verticals.setRestaurantVerticals(restaurant.id, { verticalIds: [vertical.id] });
    assert.ok((await search({ verticalId: vertical.id })).includes(restaurant.id), 'found once assigned');
});

test('assigning an unknown or switched-off vertical is refused', async () => {
    const restaurant = await makeRestaurant();
    const { vertical } = await verticals.createVertical({ name: `Closed ${stamp}`, isActive: false });
    created.verticals.push(vertical.id);
    await assert.rejects(() => verticals.setRestaurantVerticals(restaurant.id, { verticalIds: [vertical.id] }), /switched-off/);
    await assert.rejects(() => verticals.setRestaurantVerticals(restaurant.id, { verticalIds: ['a'.repeat(24)] }), /Unknown/);
    await assert.rejects(() => verticals.setRestaurantVerticals(restaurant.id, { verticalIds: 'x' }), /must be a list/);
});

test('a vertical in use is switched off on delete, an unused one is removed', async () => {
    const { vertical: used } = await verticals.createVertical({ name: `Used ${stamp}` });
    const { vertical: unused } = await verticals.createVertical({ name: `Unused ${stamp}` });
    created.verticals.push(used.id, unused.id);
    const restaurant = await makeRestaurant();
    await verticals.setRestaurantVerticals(restaurant.id, { verticalIds: [used.id] });

    const a = await verticals.deleteVertical(used.id);
    assert.equal(a.deleted, false);
    assert.equal(a.vertical.isActive, false);

    const b = await verticals.deleteVertical(unused.id);
    assert.equal(b.deleted, true);
    assert.equal(await prisma.foodVertical.findUnique({ where: { id: unused.id } }), null);
});

test('there is always exactly one default, and it cannot be removed or switched off', async () => {
    const food = await prisma.foodVertical.findUnique({ where: { slug: 'food' } });
    await assert.rejects(() => verticals.deleteVertical(food.id), /default/);
    await assert.rejects(() => verticals.updateVertical(food.id, { isActive: false }), /default/);
    await assert.rejects(() => verticals.updateVertical(food.id, { isDefault: false }), /default/);

    const { vertical } = await verticals.createVertical({ name: `New Default ${stamp}` });
    created.verticals.push(vertical.id);
    await verticals.updateVertical(vertical.id, { isDefault: true });
    assert.equal(await prisma.foodVertical.count({ where: { isDefault: true } }), 1);
    assert.equal((await prisma.foodVertical.findUnique({ where: { slug: 'food' } })).isDefault, false);

    await verticals.updateVertical(food.id, { isDefault: true });
    assert.equal((await prisma.foodVertical.findUnique({ where: { slug: 'food' } })).isDefault, true);
});

test('the public list is active verticals only, in the requested language', async () => {
    const te = await verticals.listPublicVerticals('te');
    const food = te.verticals.find((v) => v.slug === 'food');
    assert.equal(food.name, 'ఆహారం');
    assert.equal(food.nameEn, 'Food');
    assert.ok(te.verticals.every((v) => v.slug !== `closed ${stamp}`));
    const en = await verticals.listPublicVerticals('en');
    assert.equal(en.verticals.find((v) => v.slug === 'food').name, 'Food');
});

// ----- Cohorts -----

test('cohorts: zones are checked, riders join, the service area joins home and cohort zones', async () => {
    const home = await makeZone('Home Zone');
    const extra = await makeZone('Extra Zone');
    await assert.rejects(() => cohorts.createRiderCohort({ name: `Bad ${stamp}`, zoneIds: ['b'.repeat(24)] }), /Unknown zone/);

    const { cohort } = await cohorts.createRiderCohort({ name: `Night Shift ${stamp}`, zoneIds: [extra.id, extra.id] });
    created.cohorts.push(cohort.id);
    assert.deepEqual(cohort.zoneIds, [extra.id], 'duplicates folded');
    await assert.rejects(() => cohorts.createRiderCohort({ name: `night shift ${stamp}` }), /already exists/);

    const rider = await makeRider();
    await cohorts.setRiderServiceArea(rider.id, { zoneId: home.id });
    const added = await cohorts.addRidersToCohort(cohort.id, { riderIds: [rider.id] });
    assert.equal(added.ridersUpdated, 1);

    const area = await cohorts.getRiderServiceArea(rider.id);
    assert.equal(area.homeZone.id, home.id);
    assert.equal(area.cohort.id, cohort.id);
    assert.deepEqual(area.zones.map((z) => z.id), [home.id, extra.id], 'home zone first');
    assert.ok(Array.isArray(area.zones[0].coordinates), 'boundary sent for the map');

    const listed = (await cohorts.listRiderCohorts()).cohorts.find((c) => c.id === cohort.id);
    assert.equal(listed.riderCount, 1);
    assert.equal(listed.zones[0].id, extra.id);
});

test('a switched-off cohort adds no zones; clearing with null works', async () => {
    const zone = await makeZone('Off Zone');
    const { cohort } = await cohorts.createRiderCohort({ name: `Paused ${stamp}`, zoneIds: [zone.id] });
    created.cohorts.push(cohort.id);
    const rider = await makeRider();
    await cohorts.setRiderServiceArea(rider.id, { cohortId: cohort.id });
    await cohorts.updateRiderCohort(cohort.id, { isActive: false });
    assert.deepEqual((await cohorts.getRiderServiceArea(rider.id)).zones, []);

    await cohorts.setRiderServiceArea(rider.id, { cohortId: null });
    assert.equal((await prisma.foodDeliveryPartner.findUnique({ where: { id: rider.id } })).cohortId, null);
    await assert.rejects(() => cohorts.setRiderServiceArea(rider.id, {}), /Nothing to change/);
    await assert.rejects(() => cohorts.setRiderServiceArea(rider.id, { cohortId: 'c'.repeat(24) }), /Unknown cohort/);
});

test('deleting a cohort releases its riders instead of deleting them', async () => {
    const { cohort } = await cohorts.createRiderCohort({ name: `Temp ${stamp}` });
    const rider = await makeRider();
    await cohorts.addRidersToCohort(cohort.id, { riderIds: [rider.id] });
    const out = await cohorts.deleteRiderCohort(cohort.id);
    assert.equal(out.ridersReleased, 1);
    const after = await prisma.foodDeliveryPartner.findUnique({ where: { id: rider.id } });
    assert.ok(after, 'rider still exists');
    assert.equal(after.cohortId, null);
});

// ----- Telugu -----

test('translations: missing filter, single and bulk updates, all-or-nothing bulk', async () => {
    const restaurant = await makeRestaurant();
    const category = await prisma.foodCategory.create({
        data: { name: `Biryani ${stamp}`, restaurantId: restaurant.id, approvalStatus: 'approved', isApproved: true },
    });
    created.categories.push(category.id);
    const food = await prisma.foodItem.create({
        data: {
            restaurantId: restaurant.id, name: `Chicken Biryani ${stamp}`, description: 'Dum cooked',
            price: 200, categoryId: category.id, categoryName: category.name, approvalStatus: 'approved', isAvailable: true,
        },
    });
    created.foods.push(food.id);

    const missing = await translations.listTranslations({ entity: 'item', missing: 'true', restaurantId: restaurant.id });
    assert.deepEqual(missing.items.map((i) => i.id), [food.id]);

    await translations.updateTranslation('item', food.id, { nameTe: 'చికెన్ బిర్యానీ' });
    // Name done, description still not: still listed as missing.
    assert.equal((await translations.listTranslations({ entity: 'item', missing: 'true', restaurantId: restaurant.id })).total, 1);

    await assert.rejects(() => translations.bulkUpdateTranslations({
        translations: [
            { entity: 'item', id: food.id, descriptionTe: 'దమ్ వండినది' },
            { entity: 'category', id: 'd'.repeat(24), nameTe: 'x' },
        ],
    }), /not found/);
    assert.equal((await prisma.foodItem.findUnique({ where: { id: food.id } })).descriptionTe, '', 'nothing applied');

    const done = await translations.bulkUpdateTranslations({
        translations: [
            { entity: 'item', id: food.id, descriptionTe: 'దమ్ వండినది' },
            { entity: 'category', id: category.id, nameTe: 'బిర్యానీ' },
        ],
    });
    assert.equal(done.updated, 2);
    assert.equal((await translations.listTranslations({ entity: 'item', missing: 'true', restaurantId: restaurant.id })).total, 0);
    await assert.rejects(() => translations.updateTranslation('category', category.id, { descriptionTe: 'x' }), /no description/);
    await assert.rejects(() => translations.listTranslations({ entity: 'order' }), /entity must be/);

    // The public menu follows ?lang=, keeping the English beside it.
    const te = await getPublicApprovedRestaurantMenu(restaurant.id, { lang: 'te' });
    const section = te.sections.find((s) => s.categoryId === category.id);
    assert.equal(section.name, 'బిర్యానీ');
    assert.equal(section.items[0].name, 'చికెన్ బిర్యానీ');
    assert.equal(section.items[0].description, 'దమ్ వండినది');
    assert.equal(section.items[0].nameEn, `Chicken Biryani ${stamp}`);

    const en = await getPublicApprovedRestaurantMenu(restaurant.id);
    assert.equal(en.sections.find((s) => s.categoryId === category.id).items[0].name, `Chicken Biryani ${stamp}`);
});

test('a customer can save English or Telugu as their language, nothing else', async () => {
    const user = await prisma.foodUser.create({ data: { phone: uniquePhone('7') } });
    created.users.push(user.id);
    assert.equal(user.preferredLanguage, 'en', 'English by default');

    const { user: updated } = await updateCurrentUserProfile(user.id, validateUserProfileUpdateDto({ preferredLanguage: 'te' }));
    assert.equal(updated.preferredLanguage, 'te');
    assert.throws(() => validateUserProfileUpdateDto({ preferredLanguage: 'hi' }));
});
