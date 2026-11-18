import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../../utils/testIds.js';
import { getBalance } from '../../../../core/payments/transaction.service.js';
import {
    maskSecrets, stripSecrets, keepMaskedSecrets,
    getPlatformSetting, savePlatformSetting, getPublicPlatformSettings,
} from './platformSettings.service.js';
import {
    computeTopupBonus, applyTopupBonus, creditCustomerWallet, listCustomerWalletCredits,
    customerRewardsReport, couponOrderReport, bulkImportRestaurants,
} from './adminTools.service.js';
import { loadAdminServiceAccount, resetFirebaseCredentialCache } from '../../../../core/notifications/firebase.service.js';

/**
 * Pages that used to save nothing: settings pages (one JSON per page),
 * wallet credits and the top-up bonus, the rewards and coupon reports, and the
 * restaurant bulk import.
 */
const tag = uniqueTag('AT');
const created = { users: [], restaurants: [], zones: [], settings: ['ai', 'theme', 'wallet_bonus', 'firebase'] };
let saved = {};

test.before(async () => {
    // Keep whatever these keys held, and put it back afterwards.
    const rows = await prisma.foodPlatformSetting.findMany({ where: { key: { in: created.settings } } });
    saved = Object.fromEntries(rows.map((r) => [r.key, r.value]));
});

test.after(async () => {
    for (const key of created.settings) {
        if (saved[key]) await prisma.foodPlatformSetting.update({ where: { key }, data: { value: saved[key] } });
        else await prisma.foodPlatformSetting.deleteMany({ where: { key } });
    }
    await prisma.transaction.deleteMany({ where: { entityId: { in: created.users } } });
    await prisma.wallet.deleteMany({ where: { entityId: { in: created.users } } });
    await prisma.foodUser.deleteMany({ where: { id: { in: created.users } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.foodZone.deleteMany({ where: { id: { in: created.zones } } });
    await prisma.$disconnect();
});

const user = async () => {
    const u = await prisma.foodUser.create({ data: { name: `${tag} Customer`, phone: uniquePhone('5') } });
    created.users.push(u.id);
    return u;
};

// ─── Settings pages ──────────────────────────────────────────────────────────

test('secrets are masked on read, kept when sent back masked, and never public', async () => {
    assert.deepEqual(maskSecrets({ apiKey: 'sk-abcdef1234', model: 'gpt', nested: { password: 'hunter22' } }),
        { apiKey: '••••1234', model: 'gpt', nested: { password: '••••er22' } });
    assert.deepEqual(stripSecrets({ apiKey: 'x', model: 'gpt' }), { model: 'gpt' });
    assert.deepEqual(keepMaskedSecrets({ apiKey: '••••1234', model: 'b' }, { apiKey: 'sk-abcdef1234', model: 'a' }),
        { apiKey: 'sk-abcdef1234', model: 'b' });

    await savePlatformSetting('ai', { enabled: true, apiKey: 'sk-test-9999', model: 'gpt-4o' });
    const read = await getPlatformSetting('ai');
    assert.equal(read.value.apiKey, '••••9999');
    // The admin saves the page without touching the key: it is kept.
    await savePlatformSetting('ai', { ...read.value, model: 'gpt-4o-mini' });
    const raw = await prisma.foodPlatformSetting.findUnique({ where: { key: 'ai' } });
    assert.equal(raw.value.apiKey, 'sk-test-9999');
    assert.equal(raw.value.model, 'gpt-4o-mini');

    await savePlatformSetting('theme', { primaryColor: '#EB590E', accessToken: 'secret' });
    const pub = await getPublicPlatformSettings();
    assert.equal(pub.theme.primaryColor, '#EB590E');
    assert.equal(pub.theme.accessToken, undefined);
    assert.equal(pub.ai, undefined, 'AI settings are admin-only');
    await assert.rejects(() => savePlatformSetting('not_a_page', {}), /Unknown settings page/);
});

test('the Firebase page: a bad credential is refused, a good one is used for push, only the web config is public', async () => {
    await assert.rejects(() => savePlatformSetting('firebase', { serviceAccountCredential: 'not json' }), /JSON file/);
    await assert.rejects(() => savePlatformSetting('firebase', { serviceAccountCredential: '{"project_id":"x"}' }), /missing/);
    const account = { project_id: 'qs-test', client_email: 'push@qs-test.iam.gserviceaccount.com', private_key: 'test-private-key' };
    await savePlatformSetting('firebase', { serviceAccountCredential: JSON.stringify(account), apiKey: 'AIza-web-key', databaseURL: 'https://qs-test.firebaseio.com' });
    resetFirebaseCredentialCache();
    const loaded = await loadAdminServiceAccount({ force: true });
    assert.equal(loaded.client_email, account.client_email);
    const pub = await getPublicPlatformSettings();
    assert.equal(pub.firebase.apiKey, 'AIza-web-key', 'the web apiKey is public by design');
    assert.equal(pub.firebase.serviceAccountCredential, undefined, 'the service account never is');
    assert.equal((await getPlatformSetting('firebase')).value.serviceAccountCredential.startsWith('••••'), true);
});

// ─── Wallet ──────────────────────────────────────────────────────────────────

test('the best top-up bonus rule wins, within its dates and cap', () => {
    const settings = {
        enabled: true,
        rules: [
            { title: 'Flat 50', minAmount: 500, bonusType: 'flat', value: 50 },
            { title: '10%', minAmount: 1000, bonusType: 'percentage', value: 10, maxBonus: 150 },
            { title: 'Off', minAmount: 100, bonusType: 'flat', value: 999, isActive: false },
            { title: 'Expired', minAmount: 100, bonusType: 'flat', value: 500, endDate: '2020-01-01' },
        ],
    };
    assert.equal(computeTopupBonus(settings, 400).bonus, 0);
    assert.equal(computeTopupBonus(settings, 600).bonus, 50);
    assert.equal(computeTopupBonus(settings, 1200).bonus, 120);
    assert.equal(computeTopupBonus(settings, 5000).bonus, 150, 'capped');
    assert.equal(computeTopupBonus({ ...settings, enabled: false }, 5000).bonus, 0);
});

test('a top-up bonus is credited once per payment', async () => {
    const u = await user();
    await savePlatformSetting('wallet_bonus', { enabled: true, rules: [{ title: 'Big', minAmount: 100, bonusType: 'flat', value: 25 }] });
    assert.equal(await applyTopupBonus(u.id, 200, `${tag}-order-1`), 25);
    assert.equal(await applyTopupBonus(u.id, 200, `${tag}-order-1`), 25, 'a replayed callback reports the same bonus');
    assert.equal(Number((await getBalance('user', u.id)).balance), 25, 'but pays it once');
});

test('an admin credit needs a reason, pays once per request, and is listed', async () => {
    const u = await user();
    await assert.rejects(() => creditCustomerWallet(u.id, { amount: 100, requestId: 'x' }), /why/);
    await assert.rejects(() => creditCustomerWallet(u.id, { amount: 0, reason: 'r', requestId: 'x' }), /above 0/);
    await assert.rejects(() => creditCustomerWallet(u.id, { amount: 100000, reason: 'r', requestId: 'x' }), /At most/);
    const req = { amount: 150, reason: 'Late delivery', requestId: `${tag}-req-1` };
    const a = await creditCustomerWallet(u.id, req);
    const b = await creditCustomerWallet(u.id, req);
    assert.equal(a.transactionId, b.transactionId, 'a double-click credits once');
    assert.equal(Number((await getBalance('user', u.id)).balance), 150);
    const { credits } = await listCustomerWalletCredits({});
    const mine = credits.find((c) => c.customerId === u.id);
    assert.equal(mine.reason, 'Late delivery');
    assert.equal(mine.amount, 150);

    const { rows } = await customerRewardsReport({ search: u.phone });
    const row = rows.find((r) => r.userId === u.id);
    assert.equal(row.adminCredit, 150);
    assert.equal(row.total, 150);
});

// ─── Coupon report ───────────────────────────────────────────────────────────

test('the coupon order report answers with an empty shape when nothing used one', async () => {
    const r = await couponOrderReport({ couponCode: `${tag}-NONE` });
    assert.deepEqual(r.coupons, []);
    assert.deepEqual(r.orders, []);
    assert.equal(r.pagination.total, 0);
});

// ─── Bulk import ─────────────────────────────────────────────────────────────

test('bulk import creates pending restaurants and explains each refusal', async () => {
    const zone = await prisma.foodZone.create({
        data: { name: `${tag} Zone`, isActive: true, coordinates: [{ latitude: 1, longitude: 1 }, { latitude: 1.01, longitude: 1 }, { latitude: 1, longitude: 1.01 }] },
    });
    created.zones.push(zone.id);
    const phone = uniquePhone('9');
    const out = await bulkImportRestaurants([
        { restaurantName: `${tag} One`, ownerName: 'Owner', ownerPhone: phone, zone: zone.name, cuisines: 'Biryani|Chinese', latitude: '1.005', longitude: '1.002', city: 'Test' },
        { restaurantName: `${tag} Two`, ownerName: 'Owner', ownerPhone: '12345', zone: zone.name },
        { restaurantName: `${tag} Three`, ownerName: 'Owner', ownerPhone: uniquePhone('9'), zone: 'Nowhere' },
        { restaurantName: `${tag} One`, ownerName: 'Owner', ownerPhone: phone, zone: zone.name },
    ]);
    const ids = out.results.filter((r) => r.ok).map((r) => r.id);
    created.restaurants.push(...ids);
    assert.equal(out.created, 1);
    assert.equal(out.failed, 3);
    assert.match(out.results[1].reason, /10-digit/);
    assert.match(out.results[2].reason, /Unknown zone/);
    assert.match(out.results[3].reason, /already exists/);
    const r = await prisma.foodRestaurant.findUnique({ where: { id: ids[0] } });
    assert.equal(r.status, 'pending');
    assert.deepEqual(r.cuisines, ['Biryani', 'Chinese']);
    assert.equal(r.zoneId, zone.id);
});
