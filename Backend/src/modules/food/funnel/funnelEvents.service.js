import { prisma } from '../../../config/prisma.js';
import { isId } from '../../../utils/helpers.js';
import { logger } from '../../../utils/logger.js';
import {
    CLIENT_ID_RE,
    CLIENT_PLATFORMS,
    FUNNEL_EVENT_SET,
    MAX_EVENT_AGE_MS,
    MAX_EVENT_SKEW_MS,
    MAX_EVENTS_PER_BATCH,
    MAX_PROP_KEYS,
    MAX_PROPS_BYTES,
    RETENTION_DAYS,
} from './funnel.constants.js';

/**
 * Funnel events in and out of food_funnel_events.
 *
 *  - ingestEvents: the public POST /food/events batch from the apps / website.
 *    Strict: a bad event is dropped, never an error, so analytics can never
 *    break a screen.
 *  - recordServerPaymentEvent: payment_success written by the order code when
 *    an order is paid, so the last stage does not depend on the app sending
 *    it. One row per order (dedupeKey); whichever side writes first wins.
 *  - cleanupOldFunnelEvents: the scheduler's 180-day retention.
 */

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const PROP_KEY_RE = /^[A-Za-z0-9_]{1,40}$/;
const APP_VERSION_RE = /^[A-Za-z0-9_.+\- ()]{1,32}$/;
const MAX_PROP_STRING = 200;

export const paymentDedupeKey = (orderId) => `payment_success:${orderId}`;

const clientId = (value) => {
    const raw = typeof value === 'string' ? value.trim() : '';
    return CLIENT_ID_RE.test(raw) ? raw : null;
};

const idOrNull = (value) => (isId(value) ? String(value).toLowerCase() : null);

/**
 * Small flat extras only: up to 20 keys of strings (cut to 200 chars),
 * numbers, booleans or null. Anything serialising past ~2KB is dropped whole.
 */
export function sanitizeProps(props) {
    if (!isPlainObject(props)) return {};
    let size;
    try {
        size = Buffer.byteLength(JSON.stringify(props), 'utf8');
    } catch {
        return {};
    }
    if (size > MAX_PROPS_BYTES) return {};
    const out = {};
    let keys = 0;
    for (const [key, value] of Object.entries(props)) {
        if (keys >= MAX_PROP_KEYS) break;
        if (!PROP_KEY_RE.test(key)) continue;
        if (typeof value === 'string') out[key] = value.slice(0, MAX_PROP_STRING);
        else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
        else if (typeof value === 'boolean' || value === null) out[key] = value;
        else continue;
        keys += 1;
    }
    return out;
}

/** The client's own time for the event, if believable; otherwise now. */
const eventTime = (raw, now) => {
    const value = raw?.at ?? raw?.timestamp ?? raw?.ts;
    if (value === undefined || value === null || value === '') return now;
    const at = new Date(typeof value === 'number' ? value : String(value));
    const ms = at.getTime();
    if (!Number.isFinite(ms)) return now;
    if (ms > now.getTime() + MAX_EVENT_SKEW_MS || ms < now.getTime() - MAX_EVENT_AGE_MS) return now;
    return at;
};

/**
 * One event from the batch, as a row, or null to drop it. `defaults` are the
 * batch-level fields (sessionId, deviceId, platform, appVersion, zoneId) each
 * event may leave out. Exported for tests.
 */
export function sanitizeEvent(raw, defaults = {}, { userId = null, now = new Date() } = {}) {
    if (!isPlainObject(raw)) return null;
    const event = typeof raw.event === 'string' ? raw.event.trim().toLowerCase() : '';
    if (!FUNNEL_EVENT_SET.has(event)) return null;

    const sessionId = clientId(raw.sessionId ?? defaults.sessionId);
    if (!sessionId) return null;

    const platformRaw = raw.platform ?? defaults.platform;
    const platform = typeof platformRaw === 'string' ? platformRaw.trim().toLowerCase() : '';
    if (!CLIENT_PLATFORMS.includes(platform)) return null;

    const versionRaw = raw.appVersion ?? defaults.appVersion;
    const appVersion = typeof versionRaw === 'string' && APP_VERSION_RE.test(versionRaw.trim())
        ? versionRaw.trim()
        : null;

    const orderId = idOrNull(raw.orderId);
    // The server writes payment_success itself; an app copy only counts when
    // it names the order, so the two collapse into one row.
    if (event === 'payment_success' && !orderId) return null;

    const props = sanitizeProps(raw.props);
    if (event === 'app_open' && typeof raw.isFirstOpen === 'boolean' && props.isFirstOpen === undefined) {
        props.isFirstOpen = raw.isFirstOpen;
    }

    return {
        event,
        sessionId,
        deviceId: clientId(raw.deviceId ?? defaults.deviceId),
        userId: idOrNull(userId),
        platform,
        appVersion,
        zoneId: idOrNull(raw.zoneId ?? defaults.zoneId),
        restaurantId: idOrNull(raw.restaurantId),
        orderId,
        props,
        source: 'app',
        dedupeKey: event === 'payment_success' ? paymentDedupeKey(orderId) : null,
        createdAt: eventTime(raw, now),
    };
}

/** The events array of a request body: { events: [...] } or a bare array. */
const eventsOf = (body) => {
    if (Array.isArray(body)) return { list: body, defaults: {} };
    if (isPlainObject(body) && Array.isArray(body.events)) return { list: body.events, defaults: body };
    if (isPlainObject(body) && typeof body.event === 'string') return { list: [body], defaults: {} };
    return null;
};

/**
 * Store a batch. Returns { received, accepted, dropped }, or null when the
 * body is not a batch at all (the controller answers 400).
 *
 * `user` is req.user from the optional token check; only a customer token
 * attaches a userId.
 */
export async function ingestEvents(body, { user = null, now = new Date() } = {}) {
    const parsed = eventsOf(body);
    if (!parsed) return null;
    const received = parsed.list.length;
    const userId = user?.role === 'USER' && isId(user.userId) ? String(user.userId) : null;

    const rows = [];
    for (const raw of parsed.list.slice(0, MAX_EVENTS_PER_BATCH)) {
        const row = sanitizeEvent(raw, parsed.defaults, { userId, now });
        if (row) rows.push(row);
    }

    // payment_success must name a real order of the signed-in customer (signed
    // out, it is dropped: the server records it anyway). It takes the order's
    // zone, which the app may not know.
    if (!userId) {
        for (let i = rows.length - 1; i >= 0; i -= 1) {
            if (rows[i].event === 'payment_success') rows.splice(i, 1);
        }
    }
    const paidOrderIds = [...new Set(rows.filter((r) => r.event === 'payment_success').map((r) => r.orderId))];
    if (paidOrderIds.length) {
        const orders = await prisma.foodOrder.findMany({
            where: { id: { in: paidOrderIds } },
            select: { id: true, userId: true, zoneId: true, restaurantId: true },
        });
        const byId = new Map(orders.map((o) => [o.id, o]));
        for (let i = rows.length - 1; i >= 0; i -= 1) {
            const row = rows[i];
            if (row.event !== 'payment_success') continue;
            const order = byId.get(row.orderId);
            if (!order || order.userId !== userId) {
                rows.splice(i, 1);
                continue;
            }
            row.userId = row.userId || order.userId;
            row.zoneId = order.zoneId || row.zoneId;
            row.restaurantId = row.restaurantId || order.restaurantId || null;
        }
    }

    let accepted = 0;
    if (rows.length) {
        const result = await prisma.foodFunnelEvent.createMany({ data: rows, skipDuplicates: true });
        accepted = result.count;
    }
    return { received, accepted, dropped: received - accepted };
}

/** The customer's latest app session in the last 12 hours, to hang a server event on. */
async function latestSessionOf(userId) {
    if (!userId) return null;
    return prisma.foodFunnelEvent.findFirst({
        where: {
            userId,
            source: 'app',
            createdAt: { gte: new Date(Date.now() - 12 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
        select: { sessionId: true, deviceId: true, platform: true, appVersion: true },
    });
}

/**
 * payment_success (or payment_failed) for an order, written by the server.
 * Joins the customer's latest app session so the stage lines up with the rest
 * of their journey; with none, the order gets a session of its own.
 *
 * Never throws: analytics must not fail a payment. Returns true when a row was
 * written (false for a duplicate or an error).
 */
export async function recordServerPaymentEvent(orderOrId, { event = 'payment_success', method = null } = {}) {
    try {
        const order = typeof orderOrId === 'string'
            ? await prisma.foodOrder.findUnique({
                where: { id: orderOrId },
                select: { id: true, userId: true, zoneId: true, restaurantId: true, paymentMethod: true, total: true },
            })
            : orderOrId;
        if (!order?.id) return false;

        const session = await latestSessionOf(order.userId);
        const total = Number(order.total);
        const props = sanitizeProps({
            method: method || order.paymentMethod || null,
            ...(Number.isFinite(total) ? { total } : {}),
        });
        const { count } = await prisma.foodFunnelEvent.createMany({
            data: [{
                event,
                sessionId: session?.sessionId || `order:${order.id}`,
                deviceId: session?.deviceId || null,
                userId: idOrNull(order.userId),
                platform: session?.platform || 'unknown',
                appVersion: session?.appVersion || null,
                zoneId: idOrNull(order.zoneId),
                restaurantId: idOrNull(order.restaurantId),
                orderId: order.id,
                props,
                source: 'server',
                dedupeKey: event === 'payment_success' ? paymentDedupeKey(order.id) : null,
            }],
            skipDuplicates: true,
        });
        return count > 0;
    } catch (err) {
        logger.warn(`Funnel ${event} for order ${orderOrId?.id || orderOrId} not recorded: ${err?.message || err}`);
        return false;
    }
}

/** Fire-and-forget form for the order code. */
export const trackOrderPayment = (order, options) => {
    void recordServerPaymentEvent(order, options);
};

/** Retention: delete events older than `days` (180). Returns the count removed. */
export async function cleanupOldFunnelEvents({ days = RETENTION_DAYS, now = new Date() } = {}) {
    const cutoff = new Date(now.getTime() - Math.max(1, Number(days) || RETENTION_DAYS) * 86400000);
    const { count } = await prisma.foodFunnelEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return count;
}
