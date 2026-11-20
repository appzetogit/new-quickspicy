import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import {
    listReferrers,
    listReferees,
    exportReferrersCsv,
    upsertReferralZoneSetting,
    listReferralZoneSettings,
    deleteReferralZoneSetting,
} from './adminReferrals.service.js';
import { applyReferralCode } from '../../user/services/userReferral.service.js';
import { loadReferralSettingsForZone } from '../../shared/referralZone.js';
import { uniquePhone } from '../../../../utils/testIds.js';
import { testPatch } from '../../../../utils/testGeo.js';

/**
 * Per-zone referral overrides and the admin referrals report.
 * The customer's referral zone is the zone of their saved address.
 */
const tag = `RefRpt${Date.now().toString(36)}`;
const created = { users: [], partners: [], zones: [], settings: [] };
const patch = testPatch(33);
let zone;

const newUser = async (name, extra = {}) => {
    const u = await prisma.foodUser.create({ data: { phone: uniquePhone('8'), name, ...extra } });
    created.users.push(u.id);
    return u;
};

const newRider = async (name, extra = {}) => {
    const p = await prisma.foodDeliveryPartner.create({
        data: { name, phone: uniquePhone('7'), status: 'approved', ...extra },
    });
    created.partners.push(p.id);
    return p;
};

test.before(async () => {
    const s = await prisma.foodReferralSettings.create({
        data: { referralRewardUser: 50, referralLimitUser: 5, referralRewardDelivery: 100, referralLimitDelivery: 5, isActive: true },
    });
    created.settings.push(s.id);
    zone = await prisma.foodZone.create({ data: { name: `${tag} Zone`, coordinates: patch.ring } });
    created.zones.push(zone.id);
});

test.after(async () => {
    const people = [...created.users, ...created.partners];
    await prisma.foodReferralLog.deleteMany({ where: { OR: [{ refereeId: { in: people } }, { referrerId: { in: people } }] } });
    await prisma.foodReferralZoneSetting.deleteMany({ where: { zoneId: { in: created.zones } } });
    await prisma.foodUser.updateMany({ where: { id: { in: created.users } }, data: { referredById: null } });
    await prisma.foodUser.deleteMany({ where: { id: { in: created.users } } }).catch(() => {});
    await prisma.foodDeliveryPartner.updateMany({ where: { id: { in: created.partners } }, data: { referredById: null } });
    await prisma.foodDeliveryPartner.deleteMany({ where: { id: { in: created.partners } } }).catch(() => {});
    await prisma.foodZone.deleteMany({ where: { id: { in: created.zones } } }).catch(() => {});
    await prisma.foodReferralSettings.deleteMany({ where: { id: { in: created.settings } } }).catch(() => {});
    await prisma.$disconnect();
});

test('zone overrides: set, merge over global, list and remove', async () => {
    const saved = await upsertReferralZoneSetting(zone.id, { referralRewardUser: 80, referralLimitDelivery: '' });
    assert.equal(saved.referralRewardUser, 80);
    assert.equal(saved.referralLimitDelivery, null);

    const eff = await loadReferralSettingsForZone(zone.id);
    assert.equal(Number(eff.referralRewardUser), 80);
    assert.equal(Number(eff.referralRewardDelivery), 100);

    const { zoneSettings } = await listReferralZoneSettings();
    assert.ok(zoneSettings.some((z) => z.zoneId === zone.id && z.zoneName));

    await assert.rejects(upsertReferralZoneSetting(zone.id, { referralRewardUser: -1 }), /0 or more/);
    await assert.rejects(upsertReferralZoneSetting('f'.repeat(24), {}), /Zone not found/);
});

test('a customer in an overridden zone earns the zone reward for their referrer', async () => {
    await upsertReferralZoneSetting(zone.id, { referralRewardUser: 80 });
    const referrer = await newUser(`${tag} Referrer`);
    const friend = await newUser(`${tag} Friend`);
    await prisma.userAddress.create({
        data: { userId: friend.id, street: '1 St', city: 'X', state: 'Y', latitude: patch.lat, longitude: patch.lng, isDefault: true },
    });

    const res = await applyReferralCode(friend.id, referrer.id);
    assert.equal(res.reward, 80);

    // Without an address anywhere, the global reward applies.
    const plainReferrer = await newUser(`${tag} Plain`);
    const plainFriend = await newUser(`${tag} PlainFriend`);
    assert.equal((await applyReferralCode(plainFriend.id, plainReferrer.id)).reward, 50);
});

test('the report lists referrers with counts, earnings and who referred them', async () => {
    const top = await newUser(`${tag} Top`);
    const mid = await newUser(`${tag} Mid`, { referredById: top.id });
    const a = await newUser(`${tag} A`);
    const b = await newUser(`${tag} B`);
    await prisma.foodReferralLog.createMany({
        data: [
            { referrerId: top.id, refereeId: mid.id, role: 'USER', rewardAmount: 50, status: 'credited' },
            { referrerId: mid.id, refereeId: a.id, role: 'USER', rewardAmount: 50, status: 'credited' },
            { referrerId: mid.id, refereeId: b.id, role: 'USER', rewardAmount: 50, status: 'rejected', reason: 'limit_reached' },
        ],
    });

    const { referrers, total } = await listReferrers({ type: 'user', search: `${tag} Mid` });
    assert.equal(total, 1);
    const row = referrers[0];
    assert.equal(row.id, mid.id);
    assert.equal(row.referrals, 2);
    assert.equal(row.qualifiedReferrals, 1);
    assert.equal(row.totalEarned, 50);
    assert.equal(row.referredBy.id, top.id);
    assert.ok(row.latestReferralAt);

    const { referees } = await listReferees(mid.id, { type: 'user' });
    assert.deepEqual(referees.map((r) => r.status).sort(), ['credited', 'rejected']);
    assert.equal(referees.find((r) => r.status === 'rejected').earnedAmount, 0);

    // A date range before any of this finds nothing.
    const none = await listReferrers({ type: 'user', search: `${tag} Mid`, from: '2001-01-01', to: '2001-01-02' });
    assert.equal(none.total, 0);

    const { csv } = await exportReferrersCsv({ type: 'user', search: `${tag} Mid` });
    const lines = csv.trim().split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[1], new RegExp(`${tag} Mid`));
});

test('rider referrals: pending sign-ups count, zone filter uses home zone', async () => {
    const referrer = await newRider(`${tag} RiderRef`, { zoneId: zone.id });
    const signedUp = await newRider(`${tag} RiderNew`, { referredById: referrer.id, status: 'pending' });

    const inZone = await listReferrers({ type: 'delivery', zoneId: zone.id, search: `${tag} RiderRef` });
    assert.equal(inZone.total, 1);
    assert.equal(inZone.referrers[0].referrals, 1);
    assert.equal(inZone.referrers[0].qualifiedReferrals, 0);

    const { referees } = await listReferees(referrer.id, { type: 'delivery' });
    assert.equal(referees[0].id, signedUp.id);
    assert.equal(referees[0].status, 'pending');

    const elsewhere = await listReferrers({ type: 'delivery', zoneId: 'f'.repeat(24), search: `${tag} RiderRef` });
    assert.equal(elsewhere.total, 0);
});

test('removing a zone override falls back to global', async () => {
    await deleteReferralZoneSetting(zone.id);
    const eff = await loadReferralSettingsForZone(zone.id);
    assert.equal(Number(eff.referralRewardUser), 50);
});
