import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../../utils/testIds.js';
import * as settings from './businessSettings.service.js';
import { getZoneMaintenance, takeZoneOffline, bringZoneOnline, ZONE_MAINTENANCE_KEY } from './zoneMaintenance.service.js';
import {
    FSSAI_SETTINGS_KEY,
    isFssaiExpiredForOrdering,
    getFssaiOrderingBlock,
    assertFssaiValidForOrdering,
    updateFssaiComplianceSettings,
    listExpiringFssaiRestaurants,
    fssaiListingFilter,
} from '../../restaurant/services/fssaiExpiry.service.js';

/**
 * Zone/city order pause with the app-facing service status, zone maintenance
 * (all restaurants in a zone offline and back), and the expired-FSSAI block.
 *
 * Shared singletons (the business-settings row and three platform-setting
 * keys) are snapshotted and put back. This file never runs the FSSAI
 * notification sync: on a shared database it would notify real restaurants.
 */
const created = { restaurants: [], zones: [], cities: [] };
const KEYS = [ZONE_MAINTENANCE_KEY, FSSAI_SETTINGS_KEY, 'order_pause_cities'];
let pauseSnapshot = null;
let keySnapshot = [];

const DAY = 24 * 60 * 60 * 1000;

const makeZone = async (over = {}) => {
    const zone = await prisma.foodZone.create({
        data: {
            name: `Compliance Zone ${uniqueTag('Z')}`,
            coordinates: [
                { latitude: 20, longitude: 70 },
                { latitude: 21, longitude: 70 },
                { latitude: 21, longitude: 71 },
            ],
            ...over,
        },
    });
    created.zones.push(zone.id);
    return zone;
};

const makeRestaurant = async (over = {}) => {
    const r = await prisma.foodRestaurant.create({
        data: {
            restaurantName: `Compliance ${uniqueTag('R')}`,
            ownerName: 'Owner',
            ownerPhone: uniquePhone('9'),
            status: 'approved',
            ...over,
        },
    });
    created.restaurants.push(r.id);
    return r;
};

test.before(async () => {
    const row = await prisma.foodBusinessSettings.findFirst();
    pauseSnapshot = row
        ? {
            id: row.id,
            ordersPaused: row.ordersPaused,
            ordersPausedZoneIds: row.ordersPausedZoneIds,
            ordersPausedMessage: row.ordersPausedMessage,
            ordersPausedUntil: row.ordersPausedUntil,
        }
        : null;
    keySnapshot = await prisma.foodPlatformSetting.findMany({ where: { key: { in: KEYS } } });
});

test.after(async () => {
    if (pauseSnapshot) {
        const { id, ...data } = pauseSnapshot;
        await prisma.foodBusinessSettings.update({ where: { id }, data }).catch(() => {});
    } else {
        await prisma.foodBusinessSettings.updateMany({
            data: { ordersPaused: false, ordersPausedZoneIds: [], ordersPausedMessage: '', ordersPausedUntil: null },
        });
    }
    await prisma.foodPlatformSetting.deleteMany({ where: { key: { in: KEYS } } });
    for (const row of keySnapshot) {
        await prisma.foodPlatformSetting.create({ data: { key: row.key, value: row.value } });
    }
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.foodZone.deleteMany({ where: { id: { in: created.zones } } });
    await prisma.foodCity.deleteMany({ where: { id: { in: created.cities } } });
    await prisma.$disconnect();
});

test('pausing a city covers its zones, and the service status says so', async () => {
    const tag = uniqueTag('City');
    const city = await prisma.foodCity.create({ data: { name: tag, nameKey: tag.toLowerCase() } });
    created.cities.push(city.id);
    const inCity = await makeZone({ cityId: city.id });
    const elsewhere = await makeZone();

    const until = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const saved = await settings.updateOrderPause({ paused: true, cityIds: [city.id], message: 'Rain', until });
    assert.ok(saved.zoneIds.includes(inCity.id));
    assert.deepEqual(saved.cityIds, [city.id]);
    assert.deepEqual((await settings.getOrderPause()).cityIds, [city.id]);

    const here = await settings.getServiceStatus([inCity.id]);
    assert.equal(here.paused, true);
    assert.equal(here.servicePaused, true);
    assert.equal(here.message, 'Rain');
    assert.equal(here.resumeAt, until.toISOString());
    assert.equal(here.scope, 'zone');

    assert.equal((await settings.getServiceStatus([elsewhere.id])).paused, false);
    // Outside every zone: only an all-zones pause applies.
    assert.equal((await settings.getServiceStatus([])).paused, false);

    // A restaurant in the paused zone sees it on its account.
    const r = await makeRestaurant({ zoneId: inCity.id });
    assert.equal((await settings.getServiceStatusForAccount('RESTAURANT', r.id)).servicePaused, true);

    await settings.updateOrderPause({ paused: false });
    assert.equal((await settings.getServiceStatus([inCity.id])).paused, false);
    assert.deepEqual((await settings.getOrderPause()).cityIds, []);
});

test('a rider sees pauses in their cohort zones as a partial pause', async () => {
    const home = await makeZone();
    const cohortZone = await makeZone();
    const otherCohortZone = await makeZone();
    const cohort = await prisma.foodRiderCohort.create({
        data: { name: `Pause Cohort ${uniqueTag('C')}`, zoneIds: [cohortZone.id, otherCohortZone.id] },
    });
    const rider = await prisma.foodDeliveryPartner.create({
        data: { name: 'Pause Rider', phone: uniquePhone('8'), status: 'approved', zoneId: home.id, cohortId: cohort.id },
    });
    const homeless = await prisma.foodDeliveryPartner.create({
        data: { name: 'No Home Rider', phone: uniquePhone('8'), status: 'approved', cohortId: cohort.id },
    });
    try {
        // Only a cohort zone paused: not paused, but partly.
        await settings.updateOrderPause({ paused: true, zoneIds: [cohortZone.id], message: 'Flood' });
        let s = await settings.getServiceStatusForAccount('DELIVERY_PARTNER', rider.id);
        assert.equal(s.paused, false);
        assert.equal(s.servicePaused, false);
        assert.equal(s.partial, true);
        assert.deepEqual(s.pausedZones, [cohortZone.id]);
        assert.deepEqual(s.zones.map((z) => z.zoneId), [home.id, cohortZone.id, otherCohortZone.id], 'home first');
        assert.equal(s.zones[0].home, true);
        const cz = s.zones[1];
        assert.equal(cz.paused, true);
        assert.equal(cz.message, 'Flood');
        assert.equal(cz.name, cohortZone.name);
        assert.equal(s.zones[2].paused, false);

        // Home zone paused too: paused, and still partial (one cohort zone open).
        await settings.updateOrderPause({ paused: true, zoneIds: [home.id, cohortZone.id], message: 'Flood' });
        s = await settings.getServiceStatusForAccount('DELIVERY_PARTNER', rider.id);
        assert.equal(s.paused, true);
        assert.equal(s.message, 'Flood');
        assert.equal(s.scope, 'zone');
        assert.equal(s.partial, true);

        // Every zone paused: paused, not partial.
        await settings.updateOrderPause({ paused: true, zoneIds: [home.id, cohortZone.id, otherCohortZone.id] });
        s = await settings.getServiceStatusForAccount('DELIVERY_PARTNER', rider.id);
        assert.equal(s.paused, true);
        assert.equal(s.partial, false);
        assert.equal(s.pausedZones.length, 3);

        // No home zone: paused only when all cohort zones are.
        s = await settings.getServiceStatusForAccount('DELIVERY_PARTNER', homeless.id);
        assert.equal(s.paused, true);
        assert.equal(s.partial, false);
        await settings.updateOrderPause({ paused: true, zoneIds: [cohortZone.id] });
        s = await settings.getServiceStatusForAccount('DELIVERY_PARTNER', homeless.id);
        assert.equal(s.paused, false);
        assert.equal(s.partial, true);

        // An inactive cohort's zones do not count.
        await prisma.foodRiderCohort.update({ where: { id: cohort.id }, data: { isActive: false } });
        s = await settings.getServiceStatusForAccount('DELIVERY_PARTNER', rider.id);
        assert.equal(s.paused, false);
        assert.equal(s.partial, false);
        assert.deepEqual(s.zones.map((z) => z.zoneId), [home.id]);
    } finally {
        await settings.updateOrderPause({ paused: false });
        await prisma.foodDeliveryPartner.deleteMany({ where: { id: { in: [rider.id, homeless.id] } } });
        await prisma.foodRiderCohort.delete({ where: { id: cohort.id } }).catch(() => {});
    }
});

test('a city with no zones cannot become an all-zones pause by accident', async () => {
    const tag = uniqueTag('Empty');
    const city = await prisma.foodCity.create({ data: { name: tag, nameKey: tag.toLowerCase() } });
    created.cities.push(city.id);
    await assert.rejects(() => settings.updateOrderPause({ paused: true, cityIds: [city.id] }), /no zones/);
});

test('zone maintenance brings back only the restaurants it took offline', async () => {
    const zone = await makeZone();
    const a = await makeRestaurant({ zoneId: zone.id, isAcceptingOrders: true });
    const b = await makeRestaurant({ zoneId: zone.id, isAcceptingOrders: true });
    const closed = await makeRestaurant({ zoneId: zone.id, isAcceptingOrders: false });
    const otherZone = await makeRestaurant({ zoneId: (await makeZone()).id, isAcceptingOrders: true });

    const before = await getZoneMaintenance(zone.id);
    assert.equal(before.total, 3);
    assert.equal(before.online, 2);
    assert.equal(before.inMaintenance, false);

    const off = await takeZoneOffline(zone.id);
    assert.equal(off.takenOffline, 2);
    const rows = await prisma.foodRestaurant.findMany({ where: { id: { in: [a.id, b.id] } } });
    assert.ok(rows.every((r) => r.isAcceptingOrders === false && r.offlineByAdmin === true));
    assert.equal((await prisma.foodRestaurant.findUnique({ where: { id: otherZone.id } })).isAcceptingOrders, true);
    assert.equal((await getZoneMaintenance(zone.id)).inMaintenance, true);

    const on = await bringZoneOnline(zone.id);
    assert.equal(on.broughtOnline, 2);
    const after = await prisma.foodRestaurant.findMany({ where: { id: { in: [a.id, b.id, closed.id] } } });
    const byId = Object.fromEntries(after.map((r) => [r.id, r]));
    assert.equal(byId[a.id].isAcceptingOrders, true);
    assert.equal(byId[a.id].offlineByAdmin, false);
    assert.equal(byId[b.id].isAcceptingOrders, true);
    assert.equal(byId[closed.id].isAcceptingOrders, false);
    assert.equal((await getZoneMaintenance(zone.id)).inMaintenance, false);

    // Nothing saved: bringing it online again changes nothing.
    assert.equal((await bringZoneOnline(zone.id)).broughtOnline, 0);
});

test('an expired FSSAI licence blocks ordering only while the switch is on', async () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    // Valid through its expiry date.
    assert.equal(isFssaiExpiredForOrdering(today, now), false);
    assert.equal(isFssaiExpiredForOrdering(new Date(today.getTime() - DAY), now), true);
    assert.equal(isFssaiExpiredForOrdering(null, now), false);

    const expired = await makeRestaurant({ fssaiExpiry: new Date(today.getTime() - 3 * DAY) });
    const valid = await makeRestaurant({ fssaiExpiry: new Date(today.getTime() + 90 * DAY) });

    await updateFssaiComplianceSettings({ blockExpired: false });
    assert.equal((await getFssaiOrderingBlock(expired.id)).blocked, false);
    assert.equal(await fssaiListingFilter(), null);

    await updateFssaiComplianceSettings({ blockExpired: true });
    assert.equal((await getFssaiOrderingBlock(expired.id)).blocked, true);
    assert.equal((await getFssaiOrderingBlock(valid.id)).blocked, false);
    await assert.rejects(() => assertFssaiValidForOrdering({ id: expired.id, fssaiExpiry: expired.fssaiExpiry }), /FSSAI/);
    await assertFssaiValidForOrdering({ id: valid.id, fssaiExpiry: valid.fssaiExpiry });

    const filter = await fssaiListingFilter();
    const visible = await prisma.foodRestaurant.findMany({
        where: { id: { in: [expired.id, valid.id] }, AND: [filter] },
        select: { id: true },
    });
    assert.deepEqual(visible.map((r) => r.id), [valid.id]);
});

test('licences within 30 days show as expiring, with days left', async () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const soon = await makeRestaurant({ fssaiExpiry: new Date(today.getTime() + 10 * DAY) });
    const later = await makeRestaurant({ fssaiExpiry: new Date(today.getTime() + 60 * DAY) });

    const list = await listExpiringFssaiRestaurants(30);
    const ids = list.map((r) => r.restaurantId);
    assert.ok(ids.includes(soon.id));
    assert.ok(!ids.includes(later.id));
    assert.equal(list.find((r) => r.restaurantId === soon.id).daysLeft, 10);
});
