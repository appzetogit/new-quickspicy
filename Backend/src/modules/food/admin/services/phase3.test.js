import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../../utils/testIds.js';
import { ridersOutsideZone } from '../../shared/riderServiceArea.js';
import {
    istWeekStart, istDayStart, offerPeriod, offerTargets, riderTargeted, cleanTiers, grantKey,
} from '../../shared/incentiveRules.js';
import { createEarningAddon, checkEarningAddonCompletions } from './adminEarningAddon.service.js';
import { getActiveEarningAddonsForPartner } from '../../delivery/services/delivery.service.js';
import {
    weekBounds, generateWeeklyStatements, listStatements, adjustStatement, approveStatement,
    markStatementPaid, voidStatement, listOwnStatements, getOwnStatement, getStatement,
} from './payoutStatement.service.js';
import { renderStatementPdf } from './payoutStatementPdf.js';
import { getRiderDocuments, reviewRiderDocument } from '../../delivery/services/riderDocuments.service.js';
import { setZoneRidersFromZoneOnly, listZoneDispatchModes } from '../../orders/services/manualDispatch.service.js';

/**
 * Phase 3: zone-restricted dispatch, targeted / recurring / tiered incentives
 * with auto-credit, weekly payout statements, per-document rider verification.
 */
const DAY = 86400000;
const tag = uniqueTag('P3');
const created = { zones: [], cohorts: [], riders: [], restaurants: [], users: [], orders: [], addons: [], statements: [] };
const ring = (lat, lng) => [
    { latitude: lat, longitude: lng }, { latitude: lat + 0.01, longitude: lng },
    { latitude: lat + 0.01, longitude: lng + 0.01 }, { latitude: lat, longitude: lng + 0.01 },
];

const zone = async (name, extra = {}) => {
    const z = await prisma.foodZone.create({ data: { name: `${tag} ${name}`, coordinates: ring(1, 1), isActive: true, ...extra } });
    created.zones.push(z.id);
    return z;
};
const cohort = async (name, zoneIds, isActive = true) => {
    const c = await prisma.foodRiderCohort.create({ data: { name: `${tag} ${name}`, zoneIds, isActive } });
    created.cohorts.push(c.id);
    return c;
};
const rider = async (data = {}) => {
    const r = await prisma.foodDeliveryPartner.create({
        data: { name: `${tag} Rider`, phone: uniquePhone('6'), status: 'approved', ...data },
    });
    created.riders.push(r.id);
    return r;
};

let restaurantId = null;
let userId = null;
const delivered = async (riderId, count, { deliveredAt = new Date(), zoneId = null, createdAt } = {}) => {
    const ids = [];
    for (let i = 0; i < count; i += 1) {
        const o = await prisma.foodOrder.create({
            data: {
                userId, restaurantId, dispatchDeliveryPartnerId: riderId, orderStatus: 'delivered', paymentMethod: 'cash',
                addrStreet: '1 Test Street', addrCity: 'Indore', addrState: 'MP', subtotal: 230, total: 250,
                deliveredAt, zoneId, ...(createdAt ? { createdAt } : {}),
            },
        });
        created.orders.push(o.id);
        ids.push(o.id);
    }
    return ids;
};

test.before(async () => {
    const r = await prisma.foodRestaurant.create({
        data: { restaurantName: `${tag} Kitchen`, ownerName: 'Owner', ownerPhone: uniquePhone('9'), status: 'approved' },
    });
    created.restaurants.push(r.id);
    restaurantId = r.id;
    const u = await prisma.foodUser.create({ data: { phone: uniquePhone('5') } });
    created.users.push(u.id);
    userId = u.id;
});

test.after(async () => {
    const riders = created.riders;
    await prisma.foodPayoutStatement.deleteMany({
        where: { OR: [{ entityId: { in: riders } }, { entityId: { in: created.restaurants } }] },
    });
    await prisma.settlement.deleteMany({ where: { entityId: { in: [...riders, ...created.restaurants] } } });
    await prisma.foodTransaction.deleteMany({ where: { orderId: { in: created.orders } } });
    await prisma.deliveryBonusTransaction.deleteMany({ where: { deliveryPartnerId: { in: riders } } });
    await prisma.foodEarningAddonHistory.deleteMany({ where: { offerId: { in: created.addons } } });
    await prisma.foodEarningAddon.deleteMany({ where: { id: { in: created.addons } } });
    await prisma.transaction.deleteMany({ where: { entityId: { in: riders } } });
    await prisma.wallet.deleteMany({ where: { entityId: { in: riders } } });
    await prisma.foodOrder.deleteMany({ where: { id: { in: created.orders } } });
    await prisma.foodDeliveryPartner.deleteMany({ where: { id: { in: riders } } });
    await prisma.foodRiderCohort.deleteMany({ where: { id: { in: created.cohorts } } });
    await prisma.foodUser.deleteMany({ where: { id: { in: created.users } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.foodZone.deleteMany({ where: { id: { in: created.zones } } });
    await prisma.$disconnect();
});

// ─── Rules (pure) ────────────────────────────────────────────────────────────

test('IST weeks start Monday 00:00 India time', () => {
    // Wednesday 18 Nov 2026, 15:30 IST.
    assert.equal(istWeekStart(new Date('2026-11-18T10:00:00Z')).toISOString(), '2026-11-15T18:30:00.000Z');
    // Monday 23 Nov 01:30 IST is already the next week, though it is Sunday in UTC.
    assert.equal(istWeekStart(new Date('2026-11-22T20:00:00Z')).toISOString(), '2026-11-22T18:30:00.000Z');
    assert.equal(istDayStart(new Date('2026-11-22T20:00:00Z')).toISOString(), '2026-11-22T18:30:00.000Z');
});

test('a weekly offer runs per week, clipped to its own dates', () => {
    const offer = { recurrence: 'weekly', startDate: '2026-11-18T00:00:00Z', endDate: '2026-12-31T00:00:00Z' };
    const p = offerPeriod(offer, new Date('2026-11-19T10:00:00Z'));
    assert.equal(p.key, '2026-11-16');
    assert.equal(p.start.toISOString(), '2026-11-18T00:00:00.000Z', 'not before the offer began');
    assert.equal(p.end.toISOString(), '2026-11-22T18:29:59.999Z');
    assert.equal(offerPeriod(offer, new Date('2027-01-05T00:00:00Z')), null);
    assert.equal(offerPeriod({ ...offer, recurrence: 'none' }, new Date('2026-11-19T10:00:00Z')).key, '');
});

test('slabs sort and key separately; targeting needs every set filter to match', () => {
    const t = offerTargets({ criteria: 'orders', tiers: [{ requiredOrders: 8, earningAmount: 200 }, { requiredOrders: 4, earningAmount: 80 }] });
    assert.deepEqual(t.map((x) => [x.tier, x.requiredOrders, x.earningAmount]), [[1, 4, 80], [2, 8, 200]]);
    assert.equal(grantKey('2026-11-16', 2), '2026-11-16#t2');
    assert.equal(offerTargets({ criteria: 'orders', requiredOrders: 3, earningAmount: 50, tiers: [] })[0].tier, 0);
    assert.throws(() => cleanTiers([{ requiredOrders: 2, earningAmount: 1 }, { requiredOrders: 2, earningAmount: 5 }]));

    const offer = { zoneIds: ['zA'], cohortIds: ['c1'] };
    assert.equal(riderTargeted(offer, { zoneId: 'zA', cohortId: 'c1' }), true);
    assert.equal(riderTargeted(offer, { zoneId: 'zB', cohortId: 'c1' }, ['zA']), true, 'via cohort zones');
    assert.equal(riderTargeted(offer, { zoneId: 'zA', cohortId: 'c2' }), false);
    assert.equal(riderTargeted({ zoneIds: [], cohortIds: [] }, { zoneId: null, cohortId: null }), true);
});

// ─── Zone-restricted dispatch ────────────────────────────────────────────────

test('a zone set to its own riders skips riders who do not serve it', async () => {
    const a = await zone('A');
    const b = await zone('B');
    const serving = await cohort('Serves A', [a.id]);
    const off = await cohort('Off', [a.id], false);
    const home = await rider({ zoneId: a.id });
    const viaCohort = await rider({ zoneId: b.id, cohortId: serving.id });
    const outsider = await rider({ zoneId: b.id });
    const inactiveCohort = await rider({ zoneId: b.id, cohortId: off.id });
    const ids = [home.id, viaCohort.id, outsider.id, inactiveCohort.id];

    assert.equal((await ridersOutsideZone(a.id, ids)).size, 0, 'unrestricted zone: distance only');

    await setZoneRidersFromZoneOnly(a.id, true);
    const outside = await ridersOutsideZone(a.id, ids);
    assert.deepEqual([...outside].sort(), [outsider.id, inactiveCohort.id].sort());

    const modes = await listZoneDispatchModes();
    assert.equal(modes.zones.find((z) => z.id === a.id).ridersFromZoneOnly, true);
    await setZoneRidersFromZoneOnly(a.id, false);
    assert.equal((await ridersOutsideZone(a.id, ids)).size, 0);
});

// ─── Incentives ──────────────────────────────────────────────────────────────

test('a weekly tiered cohort incentive credits each slab once, this week only', async () => {
    const z = await zone('Inc');
    const c = await cohort('Weekly', [z.id]);
    const inCohort = await rider({ zoneId: z.id, cohortId: c.id });
    const notInCohort = await rider({ zoneId: z.id });
    const lastWeekOnly = await rider({ zoneId: z.id, cohortId: c.id });

    const offer = await createEarningAddon({
        title: `${tag} Weekly slabs`, criteria: 'orders', requiredOrders: 0, earningAmount: 0,
        startDate: new Date(Date.now() - 30 * DAY), endDate: new Date(Date.now() + 30 * DAY),
        recurrence: 'weekly', autoCredit: true, cohortIds: [c.id],
        tiers: [{ requiredOrders: 4, earningAmount: 150 }, { requiredOrders: 2, earningAmount: 50 }],
    });
    created.addons.push(offer.id);
    assert.equal(offer.recurrence, 'weekly');
    assert.deepEqual(offer.tiers.map((t) => t.requiredOrders), [2, 4]);

    await delivered(inCohort.id, 4);
    await delivered(notInCohort.id, 4);
    await delivered(lastWeekOnly.id, 4, { deliveredAt: new Date(istWeekStart().getTime() - DAY) });

    for (const r of [inCohort, notInCohort, lastWeekOnly]) await checkEarningAddonCompletions(r.id);
    await checkEarningAddonCompletions(inCohort.id); // again: nothing new

    const grants = await prisma.foodEarningAddonHistory.findMany({ where: { offerId: offer.id }, orderBy: { tier: 'asc' } });
    assert.equal(grants.length, 2, 'two slabs, one rider');
    assert.ok(grants.every((g) => g.deliveryPartnerId === inCohort.id && g.status === 'credited'));
    const week = offerPeriod({ ...offer, startDate: offer.startDate, endDate: offer.endDate }).key;
    assert.deepEqual(grants.map((g) => g.periodKey), [`${week}#t1`, `${week}#t2`]);
    const wallet = await prisma.wallet.findUnique({ where: { entityType_entityId: { entityType: 'deliveryBoy', entityId: inCohort.id } } });
    assert.equal(Number(wallet.balance), 200);

    // The rider's screen: both slabs paid.
    const { offers } = await getActiveEarningAddonsForPartner(inCohort.id);
    const mine = offers.find((o) => o.id === offer.id);
    assert.deepEqual(mine.targets.map((t) => t.status), ['credited', 'credited']);
    assert.equal(mine.currentOrders, 4);
    // Not offered to a rider outside the cohort.
    assert.equal((await getActiveEarningAddonsForPartner(notInCohort.id)).offers.some((o) => o.id === offer.id), false);
});

test('a zone incentive counts only orders from its zones', async () => {
    const z = await zone('Count');
    const other = await zone('Elsewhere');
    const r = await rider({ zoneId: z.id });
    const offer = await createEarningAddon({
        title: `${tag} Zone push`, criteria: 'orders', requiredOrders: 3, earningAmount: 99,
        startDate: new Date(Date.now() - DAY), endDate: new Date(Date.now() + DAY), zoneIds: [z.id],
    });
    created.addons.push(offer.id);
    await delivered(r.id, 2, { zoneId: z.id });
    await delivered(r.id, 3, { zoneId: other.id });
    await checkEarningAddonCompletions(r.id);
    assert.equal(await prisma.foodEarningAddonHistory.count({ where: { offerId: offer.id } }), 0);
    await delivered(r.id, 1, { zoneId: z.id });
    await checkEarningAddonCompletions(r.id);
    const g = await prisma.foodEarningAddonHistory.findFirst({ where: { offerId: offer.id } });
    assert.equal(g.status, 'pending', 'no autoCredit: waits for an admin');
});

// ─── Weekly payout statements ────────────────────────────────────────────────

test('statements: generate, adjust, approve, show to the owner, mark paid, stay frozen', async () => {
    const { start: lastWeek } = weekBounds();
    const r = await rider();
    const when = new Date(lastWeek.getTime() + 2 * DAY);
    const orderIds = await delivered(r.id, 2, { deliveredAt: when, createdAt: when });
    for (const [i, orderId] of orderIds.entries()) {
        await prisma.foodTransaction.create({
            data: {
                orderId, userId, restaurantId, deliveryPartnerId: r.id, paymentMethod: i === 0 ? 'cash' : 'razorpay',
                status: 'captured', subtotal: 230, total: 250, amountDue: i === 0 ? 250 : 0,
                totalCustomerPaid: 250, restaurantShare: 200, commissionAmount: 30, riderShare: 40, platformNetProfit: 10,
                createdAt: when,
            },
        });
    }

    const summary = await generateWeeklyStatements({ weekStart: lastWeek });
    assert.ok(summary.created >= 2);
    const { statements } = await listStatements({ entityId: r.id });
    assert.equal(statements.length, 1);
    const riderSt = statements[0];
    assert.equal(riderSt.status, 'draft');
    assert.equal(riderSt.orders, 2);
    assert.equal(riderSt.earnings, 80);
    assert.equal(riderSt.cashInHand, 250);
    assert.equal(riderSt.net, -170, 'owes the cash it holds');

    const restSt = (await listStatements({ entityId: restaurantId, weekStart: lastWeek })).statements[0];
    assert.equal(restSt.earnings, 400);
    assert.equal(restSt.commission, 60);
    assert.equal(restSt.grossSales, 460);

    // Drafts are the admin's; the restaurant sees nothing yet.
    assert.equal((await listOwnStatements('restaurant', restaurantId)).statements.length, 0);
    await assert.rejects(() => markStatementPaid(restSt.id, {}), /Approve the statement/);
    await assert.rejects(() => adjustStatement(restSt.id, { amount: -10 }), /what the adjustment is for/);
    assert.equal((await adjustStatement(restSt.id, { amount: -10, note: 'Damaged packaging' })).net, 390);

    // Regenerating keeps the adjustment on a draft.
    await generateWeeklyStatements({ entityType: 'restaurant', weekStart: lastWeek });
    assert.equal((await getStatement(restSt.id)).net, 390);

    await approveStatement(restSt.id, null);
    assert.equal((await listOwnStatements('restaurant', restaurantId)).statements.length, 1);
    await assert.rejects(() => getOwnStatement('rider', r.id, restSt.id), /not found/i, 'not the rider\'s');

    const paid = await markStatementPaid(restSt.id, { payoutRef: 'UTR123' });
    assert.equal(paid.status, 'paid');
    assert.equal(paid.payoutRef, 'UTR123');
    assert.ok(paid.settlementId, 'settled through the balance sheet');
    const txns = await prisma.foodTransaction.findMany({ where: { orderId: { in: orderIds } } });
    assert.ok(txns.every((t) => t.isRestaurantSettled), 'the week is settled');
    assert.ok(txns.every((t) => !t.isRiderSettled), 'the rider side is not');
    await assert.rejects(() => markStatementPaid(restSt.id, {}), /Approve the statement/, 'not twice');

    // Paid statements are frozen.
    await generateWeeklyStatements({ entityType: 'restaurant', weekStart: lastWeek });
    assert.equal((await getStatement(restSt.id)).status, 'paid');

    const pdf = await renderStatementPdf(await getOwnStatement('restaurant', restaurantId, restSt.id));
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    const riderPdf = await renderStatementPdf(await getStatement(riderSt.id));
    assert.ok(riderPdf.length > 1000);

    await voidStatement(riderSt.id, { reason: 'test' });
    assert.equal((await getStatement(riderSt.id)).status, 'void');
});

// ─── Documents ───────────────────────────────────────────────────────────────

test('each rider document gets its own verdict, reset by a new upload', async () => {
    const r = await rider({ aadharPhoto: 'food/delivery/aadhar/a1.jpg', drivingLicensePhoto: 'food/delivery/license/l1.jpg' });
    let docs = await getRiderDocuments(r.id);
    const aadhar = () => docs.documents.find((d) => d.key === 'aadharPhoto');
    assert.equal(aadhar().status, 'pending');
    assert.equal(docs.documents.find((d) => d.key === 'panPhoto').status, 'missing');
    assert.equal(docs.summary.allVerified, false);

    await assert.rejects(() => reviewRiderDocument(r.id, 'aadharPhoto', { status: 'rejected' }), /reason/);
    await assert.rejects(() => reviewRiderDocument(r.id, 'panPhoto', { status: 'approved' }), /not been uploaded/);
    docs = await reviewRiderDocument(r.id, 'aadharPhoto', { status: 'rejected', reason: 'Blurred' });
    assert.equal(aadhar().status, 'rejected');
    assert.equal(aadhar().reason, 'Blurred');
    assert.equal(aadhar().canReupload, true);

    // A new file: back to pending without anyone resetting it.
    await prisma.foodDeliveryPartner.update({ where: { id: r.id }, data: { aadharPhoto: 'food/delivery/aadhar/a2.jpg' } });
    docs = await getRiderDocuments(r.id);
    assert.equal(aadhar().status, 'pending');

    docs = await reviewRiderDocument(r.id, 'drivingLicensePhoto', { status: 'approved', expiresAt: new Date(Date.now() - DAY) });
    assert.equal(docs.documents.find((d) => d.key === 'drivingLicensePhoto').status, 'expired');
});
