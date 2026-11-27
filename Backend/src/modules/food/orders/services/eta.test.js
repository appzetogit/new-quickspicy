import test from 'node:test';
import assert from 'node:assert/strict';

import { etaMinutesFor, parsePrepMinutes } from './eta.service.js';

test('prep time is read from what restaurants type', () => {
    assert.equal(parsePrepMinutes('15-20 min'), 20);
    assert.equal(parsePrepMinutes('25'), 25);
    assert.equal(parsePrepMinutes('1 hr'), 60);
    assert.equal(parsePrepMinutes(''), null);
    assert.equal(parsePrepMinutes('quick'), null);
});

const placedAt = new Date('2026-10-24T12:00:00+05:30');
const at = (minutesLater) => new Date(placedAt.getTime() + minutesLater * 60000);

test('before pickup: the kitchen and the rider overlap, then the drive to the customer', () => {
    // 20 min to cook, rider 5 min away, 12 min drive: 20 + 12.
    assert.equal(etaMinutesFor({
        status: 'preparing', prepMinutes: 20, placedAt, now: placedAt,
        riderToRestaurant: 5, restaurantToCustomer: 12,
    }), 32);
    // Rider 30 min away: the rider is the slower part.
    assert.equal(etaMinutesFor({
        status: 'confirmed', prepMinutes: 20, placedAt, now: placedAt,
        riderToRestaurant: 30, restaurantToCustomer: 12,
    }), 42);
    // 15 minutes in, 5 minutes of cooking left.
    assert.equal(etaMinutesFor({
        status: 'preparing', prepMinutes: 20, placedAt, now: at(15),
        riderToRestaurant: null, restaurantToCustomer: 12,
    }), 17);
    // Food ready: only the rider and the drive remain.
    assert.equal(etaMinutesFor({
        status: 'ready_for_pickup', prepMinutes: 20, placedAt, now: placedAt,
        riderToRestaurant: 4, restaurantToCustomer: 12,
    }), 16);
});

test('after pickup it is the rider\'s drive to the customer', () => {
    assert.equal(etaMinutesFor({
        status: 'picked_up', prepMinutes: 20, placedAt, now: at(30),
        riderToCustomer: 7, restaurantToCustomer: 12,
    }), 7);
});

test('no drive time, no ETA', () => {
    assert.equal(etaMinutesFor({ status: 'preparing', prepMinutes: 20, placedAt, now: placedAt }), null);
});

test('prep time in hours and minutes, in the ways restaurants write it', () => {
    assert.equal(parsePrepMinutes('1 hr 30 min'), 90);
    assert.equal(parsePrepMinutes('1h'), 60);
    assert.equal(parsePrepMinutes('1h30m'), 90);
    assert.equal(parsePrepMinutes('1.5 hours'), 90);
    assert.equal(parsePrepMinutes('2 hrs'), 120);
    assert.equal(parsePrepMinutes('45 mins'), 45);
    assert.equal(parsePrepMinutes('30-45'), 45);
    assert.equal(parsePrepMinutes('1-2 hours'), 120);
    assert.equal(parsePrepMinutes('90 minutes'), 90);
});

test('no Google route: the drive is estimated from distance, not 1 minute', async () => {
    const { driveMinutes, estimateDriveMinutes } = await import('./eta.service.js');
    // ~5.6 km apart in Indore; no Maps key in tests, so fetchDrivingRoute returns no duration.
    const a = { lat: 22.7196, lng: 75.8577 };
    const b = { lat: 22.7700, lng: 75.8577 };
    const expected = estimateDriveMinutes(a, b);
    assert.ok(expected > 10, `expected a real estimate, got ${expected}`);
    assert.equal(await driveMinutes(a, b), expected);
});

test('0,0 and out-of-range positions are not positions', async () => {
    const { toFix } = await import('../../delivery/services/riderFix.js');
    assert.equal(toFix(0, 0), null);
    assert.equal(toFix(null, null), null);
    assert.equal(toFix('', ''), null);
    assert.equal(toFix(91, 10), null);
    assert.equal(toFix(10, 181), null);
    assert.deepEqual(toFix('22.7', '75.8'), { lat: 22.7, lng: 75.8 });
});
