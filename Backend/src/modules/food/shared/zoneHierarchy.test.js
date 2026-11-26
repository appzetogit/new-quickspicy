import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../utils/testIds.js';
import { testPatch } from '../../../utils/testGeo.js';
import { createZone, updateZone, deleteZone, getZones } from '../admin/services/adminZone.service.js';
import { ridersOutsideZone } from './riderServiceArea.js';
import { findZoneForPoint } from './zone.service.js';
import {
    effectiveZoneSettings, expandZoneFamilies, mainZoneIdOf, withMainZones, zoneFamilyIds, zoneMatch,
} from './zoneHierarchy.js';
import { offerCoversZone } from './offerRules.js';
import { isCodAvailable } from '../orders/services/codAvailability.service.js';
import { isOnlinePaymentAvailable } from '../orders/services/onlinePaymentAvailability.service.js';
import { loadActiveFeeSettings } from '../orders/services/order-pricing.service.js';
import {
    clearDispatchModeCache, getDispatchModeForZone, setZoneDispatchMode,
} from '../orders/services/manualDispatch.service.js';

/**
 * Main zones and small zones: a main zone is where customers order; small
 * zones inside it decide which riders get an order (the restaurant's small
 * zone, never widened) and fall back to the main zone for settings.
 */

const tag = uniqueTag('Nest');
const patch = testPatch(49);
// The patch is a 1° square; small zones are quarters of it.
const lat0 = patch.lat - 0.5;
const lng0 = patch.lng - 0.5;
const rect = (a, b, c, d) => [
    { latitude: lat0 + a, longitude: lng0 + b },
    { latitude: lat0 + a, longitude: lng0 + d },
    { latitude: lat0 + c, longitude: lng0 + d },
    { latitude: lat0 + c, longitude: lng0 + b },
];

const zones = [];
const riders = [];
const fees = [];
let main;
let west;
let east;

test.before(async () => {
    ({ zone: main } = await createZone({ name: `${tag} Main`, city: `${tag} City`, createCity: true, coordinates: patch.ring }));
    zones.push(main.id);
    ({ zone: west } = await createZone({ name: `${tag} West`, parentZoneId: main.id, coordinates: rect(0.1, 0.1, 0.9, 0.45) }));
    zones.push(west.id);
    ({ zone: east } = await createZone({ name: `${tag} East`, parentZoneId: main.id, coordinates: rect(0.1, 0.55, 0.9, 0.9) }));
    zones.push(east.id);
});

test.after(async () => {
    await prisma.foodFeeSettings.deleteMany({ where: { id: { in: fees } } });
    await prisma.foodDeliveryPartner.deleteMany({ where: { id: { in: riders } } });
    await prisma.foodZone.deleteMany({ where: { id: { in: zones } } });
    const cities = await prisma.foodCity.findMany({ where: { name: { startsWith: tag } }, select: { id: true } });
    await prisma.foodCity.deleteMany({ where: { id: { in: cities.map((c) => c.id) } } });
    await prisma.$disconnect();
});

const rider = async (data) => {
    const r = await prisma.foodDeliveryPartner.create({
        data: { name: `${tag} Rider`, phone: uniquePhone('6'), status: 'approved', ...data },
    });
    riders.push(r.id);
    return r;
};

test('a small zone takes its main zone\'s city and is listed as small', async () => {
    assert.equal(west.parentZoneId, main.id);
    assert.equal(west.cityId, main.cityId);
    const { zones: listed } = await getZones({ parentZoneId: main.id });
    assert.deepEqual(listed.map((z) => z.id).sort(), [west.id, east.id].sort());
    assert.ok(listed.every((z) => z.kind === 'small'));
    const mainRow = (await getZones({ search: `${tag} Main` })).zones.find((z) => z.id === main.id);
    assert.equal(mainRow.kind, 'main');
    assert.equal(mainRow.smallZoneCount, 2);
});

test('shapes: inside the main zone, no overlap, main zone keeps them, one level only', async () => {
    await assert.rejects(
        () => createZone({ name: `${tag} Outside`, parentZoneId: main.id, coordinates: rect(0.5, 0.5, 1.5, 1.5) }),
        /inside its main zone/,
    );
    await assert.rejects(
        () => createZone({ name: `${tag} Overlap`, parentZoneId: main.id, coordinates: rect(0.2, 0.3, 0.8, 0.7) }),
        /cannot overlap/,
    );
    await assert.rejects(
        () => createZone({ name: `${tag} Nested`, parentZoneId: west.id, coordinates: rect(0.2, 0.2, 0.3, 0.3) }),
        /itself a small zone/,
    );
    // Shrinking the main zone so East falls outside it is refused, and rolled back.
    await assert.rejects(() => updateZone(main.id, { coordinates: rect(0, 0, 1, 0.5) }), /still contain/);
    const after = await prisma.foodZone.findUnique({ where: { id: main.id } });
    assert.equal(after.coordinates.length, 4);
    assert.equal(Number(after.coordinates[1].longitude), patch.ring[1].longitude);

    await assert.rejects(() => deleteZone(main.id), /has 2 small zones/);
    await assert.rejects(() => updateZone(main.id, { parentZoneId: east.id }), /itself a small zone|small zones of its own/);
});

test('a point in a small zone resolves to it; its main zone is one step up', async () => {
    const inWest = await findZoneForPoint(lat0 + 0.5, lng0 + 0.2);
    assert.equal(inWest.id, west.id);
    const between = await findZoneForPoint(lat0 + 0.5, lng0 + 0.5);
    assert.equal(between.id, main.id, 'inside the main zone but no small zone');
    assert.equal(await mainZoneIdOf(west.id), main.id);
    assert.equal(await mainZoneIdOf(main.id), main.id);
    assert.deepEqual((await withMainZones([east.id])).sort(), [east.id, main.id].sort());
    assert.deepEqual((await zoneFamilyIds(main.id)).sort(), [main.id, west.id, east.id].sort());
    assert.deepEqual(await zoneFamilyIds(west.id), [west.id]);
    assert.deepEqual((await expandZoneFamilies([main.id])).sort(), [main.id, west.id, east.id].sort());
    assert.deepEqual((await zoneMatch(main.id)).in.sort(), [main.id, west.id, east.id].sort());
    assert.equal(await zoneMatch(west.id), west.id);
});

test('a small zone\'s orders go only to its riders, never widened; the main zone takes them all', async () => {
    const westRider = await rider({ zoneId: west.id });
    const bothRider = await rider({ zoneId: east.id, serviceZoneIds: [west.id] });
    const eastRider = await rider({ zoneId: east.id });
    const nowhere = await rider({});
    const ids = [westRider.id, bothRider.id, eastRider.id, nowhere.id];

    // Small zones are always restricted, without the ridersFromZoneOnly switch.
    assert.deepEqual([...(await ridersOutsideZone(west.id, ids))].sort(), [eastRider.id, nowhere.id].sort());
    assert.deepEqual([...(await ridersOutsideZone(east.id, ids))].sort(), [westRider.id, nowhere.id].sort());
    // The main zone itself is not restricted unless switched on...
    assert.equal((await ridersOutsideZone(main.id, ids)).size, 0);
    // ...and when it is, every rider of its small zones serves it.
    await prisma.foodZone.update({ where: { id: main.id }, data: { ridersFromZoneOnly: true } });
    try {
        assert.deepEqual([...(await ridersOutsideZone(main.id, ids))], [nowhere.id]);
    } finally {
        await prisma.foodZone.update({ where: { id: main.id }, data: { ridersFromZoneOnly: false } });
    }
});

test('COD, online payment and dispatch mode: blank on the small zone follows the main zone', async () => {
    await prisma.foodZone.update({ where: { id: main.id }, data: { codEnabled: false, onlinePaymentEnabled: false } });
    try {
        assert.equal((await isCodAvailable({ zoneId: west.id })).allowed, false, 'follows main');
        assert.equal((await isOnlinePaymentAvailable({ zoneId: west.id })).allowed, false);
        // The small zone's own answer wins.
        await prisma.foodZone.update({ where: { id: west.id }, data: { codEnabled: true, onlinePaymentEnabled: true } });
        assert.equal((await isCodAvailable({ zoneId: west.id })).allowed, true);
        assert.equal((await isOnlinePaymentAvailable({ zoneId: west.id })).allowed, true);
        assert.equal((await isCodAvailable({ zoneId: east.id })).allowed, false, 'east still follows main');

        const merged = await effectiveZoneSettings(east.id, ['codEnabled', 'onlinePaymentEnabled']);
        assert.equal(merged.codEnabled, false);
    } finally {
        await prisma.foodZone.updateMany({
            where: { id: { in: [main.id, west.id] } },
            data: { codEnabled: null, onlinePaymentEnabled: null },
        });
    }

    await setZoneDispatchMode(main.id, 'manual');
    try {
        clearDispatchModeCache();
        assert.equal(await getDispatchModeForZone(east.id), 'manual', 'follows main');
        await setZoneDispatchMode(east.id, 'auto');
        assert.equal(await getDispatchModeForZone(east.id), 'auto', 'own mode wins');
        assert.equal(await getDispatchModeForZone(west.id), 'manual');
    } finally {
        await setZoneDispatchMode(east.id, null);
        await setZoneDispatchMode(main.id, null);
    }
});

test('fees: a small zone\'s blanks come from the main zone, then the platform', async () => {
    const mainFees = await prisma.foodFeeSettings.create({
        data: { zoneId: main.id, isActive: true, deliveryFee: 31, platformFee: 7 },
    });
    fees.push(mainFees.id);
    assert.equal(Number((await loadActiveFeeSettings(west.id)).deliveryFee), 31, 'no row of its own: main zone');

    const westFees = await prisma.foodFeeSettings.create({
        data: { zoneId: west.id, isActive: true, deliveryFee: 19, platformFee: null },
    });
    fees.push(westFees.id);
    const west1 = await loadActiveFeeSettings(west.id);
    assert.equal(Number(west1.deliveryFee), 19, 'its own value wins');
    assert.equal(Number(west1.platformFee), 7, 'blank follows the main zone');
    assert.equal(Number((await loadActiveFeeSettings(east.id)).deliveryFee), 31);
});

test('a coupon for the main zone covers its small zones, not the other way round', () => {
    const forMain = { zoneIds: [main.id] };
    const forWest = { zoneIds: [west.id] };
    assert.equal(offerCoversZone(forMain, west.id, null, main.id), true);
    assert.equal(offerCoversZone(forMain, west.id, null, null), false, 'without the main zone it cannot tell');
    assert.equal(offerCoversZone(forWest, east.id, null, main.id), false);
    assert.equal(offerCoversZone(forWest, west.id, null, main.id), true);
});
