import test from 'node:test';
import assert from 'node:assert/strict';

import { prisma } from '../../../config/prisma.js';
import { uniquePhone, uniqueTag } from '../../../utils/testIds.js';
import { testPatch } from '../../../utils/testGeo.js';
import { startTestServer, tokenFor } from '../../../utils/testHttp.js';
import { addDays, istDayOf } from '../admin/services/reportDays.js';
import {
    cleanupOldFunnelEvents,
    ingestEvents,
    recordServerPaymentEvent,
    sanitizeEvent,
    sanitizeProps,
} from './funnelEvents.service.js';
import { buildStages, fillDaily, getFunnelReport } from './funnelReport.service.js';

/**
 * Customer funnel: event ingestion, the server's own payment_success, the
 * admin report and retention. The report is always asked for a zone of this
 * file's own, so events from other runs never leak in.
 */
const HERE = testPatch(46);
const created = { zones: [], restaurants: [], users: [], orders: [], sessions: [] };
let zoneId = null;
let restaurantId = null;
let userId = null;
let http = null;

const session = (label = 'S') => {
    const id = uniqueTag(`fn${label}`);
    created.sessions.push(id);
    return id;
};

// Two days ago (India), well inside the retention period.
const DAY = addDays(istDayOf(), -2);
const at = (hhmm) => new Date(`${DAY}T${hhmm}:00+05:30`);

const makeOrder = async (over = {}) => {
    const order = await prisma.foodOrder.create({
        data: {
            userId,
            restaurantId,
            zoneId,
            order_id: uniqueTag('QS'),
            orderStatus: 'created',
            paymentMethod: 'cash',
            paymentStatus: 'cod_pending',
            addrStreet: '1 Test Street',
            addrCity: 'Indore',
            addrState: 'MP',
            subtotal: 300,
            total: 350,
            ...over,
        },
    });
    created.orders.push(order.id);
    return order;
};

test.before(async () => {
    const zone = await prisma.foodZone.create({
        data: { name: `Funnel Zone ${uniqueTag('Z')}`, coordinates: HERE.ring },
    });
    created.zones.push(zone.id);
    zoneId = zone.id;

    const r = await prisma.foodRestaurant.create({
        data: {
            restaurantName: `Funnel Kitchen ${uniqueTag('R')}`,
            ownerName: 'Owner',
            ownerPhone: uniquePhone('9'),
            status: 'approved',
            zoneId,
        },
    });
    created.restaurants.push(r.id);
    restaurantId = r.id;

    // Signed up long before the report's range: a returning customer.
    const u = await prisma.foodUser.create({ data: { phone: uniquePhone('5'), createdAt: new Date('2025-01-01T00:00:00Z') } });
    created.users.push(u.id);
    userId = u.id;

    http = await startTestServer();
});

test.after(async () => {
    await prisma.foodFunnelEvent.deleteMany({
        where: {
            OR: [
                { sessionId: { in: created.sessions } },
                { orderId: { in: created.orders } },
                { userId: { in: created.users } },
                { zoneId: { in: created.zones } },
            ],
        },
    });
    await prisma.foodOrder.deleteMany({ where: { id: { in: created.orders } } });
    await prisma.foodRestaurant.deleteMany({ where: { id: { in: created.restaurants } } });
    await prisma.foodUser.deleteMany({ where: { id: { in: created.users } } });
    await prisma.foodZone.deleteMany({ where: { id: { in: created.zones } } });
    if (http) await http.close();
    await prisma.$disconnect();
});

// ----- pure -----

test('sanitizeEvent keeps the allow-list and drops anything malformed', () => {
    const base = { sessionId: 'sess-12345678', platform: 'android' };
    assert.equal(sanitizeEvent({ ...base, event: 'something_else' }), null, 'unknown event');
    assert.equal(sanitizeEvent({ ...base, event: 'app_open', sessionId: 'x' }), null, 'short session id');
    assert.equal(sanitizeEvent({ ...base, event: 'app_open', platform: 'windows' }), null, 'unknown platform');
    assert.equal(sanitizeEvent({ ...base, event: 'payment_success' }), null, 'payment_success needs an order');
    assert.equal(sanitizeEvent('app_open'), null);
    assert.equal(sanitizeEvent(null), null);

    const row = sanitizeEvent(
        { event: 'APP_OPEN', isFirstOpen: true, restaurantId: 'not-an-id', appVersion: '2.3.1 (45)' },
        { ...base, deviceId: 'device-abcdef01' },
        { userId: 'a'.repeat(24) },
    );
    assert.equal(row.event, 'app_open');
    assert.equal(row.platform, 'android');
    assert.equal(row.deviceId, 'device-abcdef01');
    assert.equal(row.userId, 'a'.repeat(24));
    assert.equal(row.restaurantId, null);
    assert.equal(row.appVersion, '2.3.1 (45)');
    assert.deepEqual(row.props, { isFirstOpen: true });
});

test('a believable client time is kept, an implausible one becomes now', () => {
    const now = new Date('2026-06-01T10:00:00Z');
    const ev = (atValue) => sanitizeEvent({ event: 'add_to_cart', sessionId: 'sess-12345678', platform: 'ios', at: atValue }, {}, { now });
    assert.equal(ev('2026-06-01T09:00:00Z').createdAt.toISOString(), '2026-06-01T09:00:00.000Z');
    assert.equal(ev('2026-05-01T09:00:00Z').createdAt, now, 'older than a day');
    assert.equal(ev('2026-06-02T09:00:00Z').createdAt, now, 'in the future');
    assert.equal(ev('garbage').createdAt, now);
});

test('props are small and flat; anything over ~2KB is dropped', () => {
    assert.deepEqual(sanitizeProps({ big: 'x'.repeat(3000) }), {});
    assert.deepEqual(sanitizeProps('text'), {});
    assert.deepEqual(sanitizeProps([1, 2]), {});
    assert.deepEqual(
        sanitizeProps({ ok: 1, flag: false, nested: { a: 1 }, 'bad key': 1, none: null, s: 'y'.repeat(300) }),
        { ok: 1, flag: false, none: null, s: 'y'.repeat(200) },
    );
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    assert.equal(Object.keys(sanitizeProps(many)).length, 20);
});

test('buildStages works out conversion and drop-off', () => {
    const stages = buildStages({
        app_open: { sessions: 200, users: 50 },
        restaurant_view: { sessions: 100, users: 40 },
        add_to_cart: { sessions: 40, users: 30 },
        checkout_start: { sessions: 20, users: 20 },
        payment_success: { sessions: 10, users: 10 },
    });
    assert.deepEqual(stages.map((s) => s.fromPrevious), [null, 50, 40, 50, 50]);
    assert.deepEqual(stages.map((s) => s.fromFirst), [100, 50, 20, 10, 5]);
    assert.deepEqual(stages.map((s) => s.dropOff), [null, 50, 60, 50, 50]);
    assert.deepEqual(stages.map((s) => s.dropped), [0, 100, 60, 20, 10]);
    assert.deepEqual(buildStages({}).map((s) => s.fromPrevious), [null, null, null, null, null], 'no division by zero');
});

test('fillDaily gives every day of the range', () => {
    const days = fillDaily([{ day: '2026-01-02', event: 'app_open', sessions: 3 }], '2026-01-01', '2026-01-03');
    assert.deepEqual(days.map((d) => d.day), ['2026-01-01', '2026-01-02', '2026-01-03']);
    assert.equal(days[1].app_open, 3);
    assert.equal(days[0].payment_success, 0);
});

// ----- ingestion -----

test('a batch is stored without a sign-in; bad events are dropped, not fatal', async () => {
    const s = session('A');
    const events = [
        { event: 'app_open', isFirstOpen: true },
        { event: 'restaurant_view', restaurantId, zoneId },
        { event: 'made_up' },
        { event: 'add_to_cart', props: { huge: 'z'.repeat(5000) } },
        'not an object',
    ];
    const result = await ingestEvents({ sessionId: s, platform: 'web', events });
    assert.deepEqual(result, { received: 5, accepted: 3, dropped: 2 });

    const rows = await prisma.foodFunnelEvent.findMany({ where: { sessionId: s }, orderBy: { event: 'asc' } });
    assert.deepEqual(rows.map((r) => r.event), ['add_to_cart', 'app_open', 'restaurant_view']);
    assert.ok(rows.every((r) => r.userId === null && r.platform === 'web' && r.source === 'app'));
    assert.deepEqual(rows[0].props, {}, 'oversized props dropped');
    assert.equal(rows[1].props.isFirstOpen, true);

    assert.equal(await ingestEvents({ nothing: true }), null, 'not a batch');
    assert.equal(await ingestEvents('text'), null);
});

test('only the first 50 events of a batch are read', async () => {
    const s = session('B');
    const events = Array.from({ length: 60 }, () => ({ event: 'menu_item_view' }));
    const result = await ingestEvents({ sessionId: s, platform: 'android', events });
    assert.equal(result.accepted, 50);
    assert.equal(result.dropped, 10);
});

test('a customer token attaches the user; any other role does not', async () => {
    const s = session('C');
    await ingestEvents({ sessionId: s, platform: 'ios', events: [{ event: 'checkout_start' }] }, { user: { role: 'USER', userId } });
    await ingestEvents({ sessionId: s, platform: 'ios', events: [{ event: 'add_to_cart' }] }, { user: { role: 'RESTAURANT', userId } });
    const rows = await prisma.foodFunnelEvent.findMany({ where: { sessionId: s } });
    assert.equal(rows.find((r) => r.event === 'checkout_start').userId, userId);
    assert.equal(rows.find((r) => r.event === 'add_to_cart').userId, null);
});

test('payment_success is one row per order, whoever sends it first', async () => {
    const s = session('D');
    const order = await makeOrder();
    const user = { role: 'USER', userId };

    // Not a real order: dropped.
    const fake = await ingestEvents({ sessionId: s, platform: 'web', events: [{ event: 'payment_success', orderId: 'f'.repeat(24) }] }, { user });
    assert.equal(fake.accepted, 0);
    // Signed out, or someone else's order: dropped.
    const anon = await ingestEvents({ sessionId: s, platform: 'web', events: [{ event: 'payment_success', orderId: order.id }] });
    assert.equal(anon.accepted, 0);
    const other = await ingestEvents({ sessionId: s, platform: 'web', events: [{ event: 'payment_success', orderId: order.id }] }, { user: { role: 'USER', userId: 'e'.repeat(24) } });
    assert.equal(other.accepted, 0);

    const first = await ingestEvents({ sessionId: s, platform: 'web', events: [{ event: 'payment_success', orderId: order.id }, { event: 'payment_success', orderId: order.id }] }, { user });
    assert.equal(first.accepted, 1, 'the duplicate in the batch collapses');
    assert.equal(await recordServerPaymentEvent(order.id), false, 'the server copy is a duplicate');

    const rows = await prisma.foodFunnelEvent.findMany({ where: { orderId: order.id, event: 'payment_success' } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].zoneId, zoneId, 'takes the order zone');
    assert.equal(rows[0].source, 'app');
});

test('the server payment_success joins the customer\'s latest session', async () => {
    const s = session('E');
    await ingestEvents({ sessionId: s, platform: 'android', appVersion: '1.0.0', events: [{ event: 'checkout_start' }] }, { user: { role: 'USER', userId } });
    const order = await makeOrder({ paymentMethod: 'razorpay', paymentStatus: 'paid' });

    assert.equal(await recordServerPaymentEvent(order.id), true);
    assert.equal(await recordServerPaymentEvent(order.id), false, 'recorded once');
    const row = await prisma.foodFunnelEvent.findFirst({ where: { orderId: order.id, event: 'payment_success' } });
    assert.equal(row.sessionId, s);
    assert.equal(row.platform, 'android');
    assert.equal(row.source, 'server');
    assert.equal(row.props.method, 'razorpay');

    // payment_failed is not deduped and never throws on a missing order.
    assert.equal(await recordServerPaymentEvent(order.id, { event: 'payment_failed' }), true);
    assert.equal(await recordServerPaymentEvent('0'.repeat(24)), false);
});

test('POST /api/v1/food/events answers 202 for a batch and 400 for junk', async () => {
    const s = session('F');
    const ok = await http.post('/api/v1/food/events', {
        body: { sessionId: s, platform: 'web', events: [{ event: 'app_open' }, { event: 'nope' }] },
        token: tokenFor({ userId, role: 'USER' }),
    });
    assert.equal(ok.status, 202);
    assert.equal(ok.body.data.accepted, 1);
    const row = await prisma.foodFunnelEvent.findFirst({ where: { sessionId: s } });
    assert.equal(row.userId, userId);

    const anonymous = await http.post('/api/v1/food/events', { body: { sessionId: session('G'), platform: 'ios', events: [{ event: 'app_open' }] } });
    assert.equal(anonymous.status, 202);

    const badToken = await http.post('/api/v1/food/events', { body: { sessionId: session('H'), platform: 'ios', events: [{ event: 'app_open' }] }, token: 'garbage' });
    assert.equal(badToken.status, 202, 'a bad token is ignored, not refused');

    const junk = await http.post('/api/v1/food/events', { body: { hello: 'world' } });
    assert.equal(junk.status, 400);
});

// ----- report -----

test('the funnel report counts sessions per stage for the zone', async () => {
    const A = session('rA'); // returning customer, all the way to paid
    const B = session('rB'); // guest, to cart
    const C = session('rC'); // guest on android, browsed only
    const D = session('rD'); // guest, no app_open recorded
    const E = session('rE'); // app_open only, no zone: not in this zone
    const order = await makeOrder();
    const row = (sessionId, event, extra = {}) => ({
        sessionId, event, platform: 'web', createdAt: at('12:00'), zoneId, ...extra,
    });
    await prisma.foodFunnelEvent.createMany({
        data: [
            row(A, 'app_open', { zoneId: null, userId, props: { isFirstOpen: true } }),
            row(A, 'restaurant_view', { userId, restaurantId }),
            row(A, 'add_to_cart', { userId }),
            row(A, 'checkout_start', { userId }),
            row(A, 'payment_success', { userId, orderId: order.id, dedupeKey: `payment_success:${order.id}` }),
            row(B, 'app_open', { zoneId: null }),
            row(B, 'restaurant_view'),
            row(B, 'restaurant_view', { createdAt: at('12:05') }),
            row(B, 'add_to_cart'),
            row(C, 'app_open', { platform: 'android' }),
            row(C, 'restaurant_view', { platform: 'android' }),
            row(D, 'restaurant_view'),
            row(D, 'add_to_cart'),
            row(E, 'app_open', { zoneId: null }),
        ],
    });

    const report = await getFunnelReport({ fromDate: DAY, toDate: DAY, zoneId });
    const by = Object.fromEntries(report.stages.map((s) => [s.key, s]));
    assert.equal(by.app_open.sessions, 3);
    assert.equal(by.restaurant_view.sessions, 4);
    assert.equal(by.add_to_cart.sessions, 3);
    assert.equal(by.checkout_start.sessions, 1);
    assert.equal(by.payment_success.sessions, 1);
    assert.equal(by.payment_success.users, 1);
    assert.equal(by.restaurant_view.inOrder, 3, 'D skipped app_open');
    assert.equal(by.add_to_cart.inOrder, 2);
    assert.equal(by.add_to_cart.fromPrevious, 75);
    assert.equal(by.payment_success.fromFirst, 33.3);
    assert.equal(report.totals.sessions, 4);
    assert.equal(report.totals.installs, 1);

    const seg = Object.fromEntries(report.segments.map((s) => [s.key, s]));
    assert.equal(seg.returning.sessions, 1);
    assert.equal(seg.guest.sessions, 3);
    assert.equal(seg.new.sessions, 0);

    const day = report.daily.find((d) => d.day === DAY);
    assert.equal(day.app_open, 3);
    assert.equal(day.restaurant_view, 4, 'B counted once though it viewed twice');

    const android = await getFunnelReport({ fromDate: DAY, toDate: DAY, zoneId, platform: 'android' });
    assert.equal(android.stages[0].sessions, 1);
    assert.equal(android.stages[2].sessions, 0);

    const otherDay = await getFunnelReport({ fromDate: addDays(DAY, -5), toDate: addDays(DAY, -4), zoneId });
    assert.equal(otherDay.totals.sessions, 0);
    assert.equal(otherDay.daily.length, 2);

    const noSuchZone = await getFunnelReport({ fromDate: DAY, toDate: DAY, zoneId: 'No Such Zone Anywhere' });
    assert.equal(noSuchZone.totals.sessions, 0);
});

// ----- retention -----

test('cleanup removes events older than 180 days and keeps the rest', async () => {
    const oldS = session('old');
    const newS = session('new');
    const now = new Date();
    await prisma.foodFunnelEvent.createMany({
        data: [
            { sessionId: oldS, event: 'app_open', platform: 'web', createdAt: new Date(now.getTime() - 200 * 86400000) },
            { sessionId: newS, event: 'app_open', platform: 'web', createdAt: new Date(now.getTime() - 10 * 86400000) },
        ],
    });
    const removed = await cleanupOldFunnelEvents({ now });
    assert.ok(removed >= 1);
    assert.equal(await prisma.foodFunnelEvent.count({ where: { sessionId: oldS } }), 0);
    assert.equal(await prisma.foodFunnelEvent.count({ where: { sessionId: newS } }), 1);
});
