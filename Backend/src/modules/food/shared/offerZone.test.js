process.env.TZ = 'UTC';

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkOfferEligibility, offerCoversZone, isZoneRestricted } from './offerRules.js';
import { mergeReferralSettings } from './referralZone.js';

/** Zone/city-limited coupons and per-zone referral settings (pure parts). */

const NOW = new Date('2026-09-16T06:30:00Z');
const offer = (extra = {}) => ({
    status: 'active', showInCart: true, discountType: 'flat_price', discountValue: 50,
    minOrderValue: 100, customerScope: 'all', restaurantScope: 'all',
    activeDays: [], zoneIds: [], cityIds: [], ...extra,
});
const check = (o, extra = {}) => checkOfferEligibility({ offer: o, subtotal: 300, restaurantId: 'r1', now: NOW, ...extra });

test('a coupon with no zones or cities works everywhere, even with no zone known', () => {
    assert.equal(isZoneRestricted(offer()), false);
    assert.equal(check(offer()).ok, true);
    assert.equal(check(offer(), { zoneId: 'z9' }).ok, true);
});

test('a zone-limited coupon works only in its zones', () => {
    const o = offer({ zoneIds: ['z1', 'z2'] });
    assert.equal(isZoneRestricted(o), true);
    assert.equal(check(o, { zoneId: 'z2' }).ok, true);
    const out = check(o, { zoneId: 'z3' });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'wrong-zone');
    assert.match(out.message, /not valid in this area/);
    // Unknown zone: refused, nothing shows the order is inside the area.
    assert.equal(check(o).code, 'wrong-zone');
});

test('a city-limited coupon works in any zone of that city', () => {
    const o = offer({ cityIds: ['c1'] });
    assert.equal(check(o, { zoneId: 'z5', cityId: 'c1' }).ok, true);
    assert.equal(check(o, { zoneId: 'z5', cityId: 'c2' }).code, 'wrong-zone');
    // Zones and cities together: either match is enough.
    assert.equal(offerCoversZone(offer({ zoneIds: ['z1'], cityIds: ['c1'] }), 'z1', 'c9'), true);
    assert.equal(offerCoversZone(offer({ zoneIds: ['z1'], cityIds: ['c1'] }), 'z7', 'c1'), true);
});

test('wrong restaurant is reported before wrong zone', () => {
    const o = offer({ restaurantScope: 'selected', restaurantIds: ['r2'], zoneIds: ['z1'] });
    assert.equal(check(o, { zoneId: 'z9' }).code, 'wrong-restaurant');
});

test('zone referral settings override only the fields they set', () => {
    const global = { referralRewardUser: 50, referralRewardDelivery: 100, referralLimitUser: 5, referralLimitDelivery: 3, referralLinkUser: 'x' };
    const merged = mergeReferralSettings(global, {
        zoneId: 'z1', referralRewardUser: 80, referralRewardDelivery: null, referralLimitUser: null, referralLimitDelivery: 10, isActive: true,
    });
    assert.equal(merged.referralRewardUser, 80);
    assert.equal(merged.referralRewardDelivery, 100);
    assert.equal(merged.referralLimitUser, 5);
    assert.equal(merged.referralLimitDelivery, 10);
    assert.equal(merged.referralLinkUser, 'x');
    assert.equal(merged.zoneOverride, true);

    // An inactive override is ignored; no override = global as is.
    assert.equal(mergeReferralSettings(global, { zoneId: 'z1', referralRewardUser: 1, isActive: false }).referralRewardUser, 50);
    assert.deepEqual(mergeReferralSettings(global, null), global);
});
