import { prisma } from '../../../../config/prisma.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { logger } from '../../../../utils/logger.js';
import { runUnscoped } from '../../../../core/roles/adminScope.context.js';
import { fetchDrivingRoute } from '../utils/googleMaps.js';
import { haversineKm } from '../../shared/geo.utils.js';
import { toFix } from '../../delivery/services/riderFix.js';

/**
 * The delivery ETA, worked out by the server for every live order.
 *
 * Nobody got an ETA unless someone typed one in. Now each order carries
 * etaMinutes and estimatedDeliveryAt, refreshed on every status change and on
 * the rider's location pings, and pushed to the customer as `order_eta`.
 *
 *  Before pickup: the later of (the kitchen finishing, the rider reaching the
 *    restaurant), plus the drive from the restaurant to the customer. The rider
 *    rides over while the food cooks, so the two overlap rather than add up.
 *  After pickup: the drive from the rider's position to the customer.
 *
 * Drive times come from Google Directions (the server key), falling back to
 * straight-line distance at city speed when there is no key, no route or no
 * position. Refreshed at most once a minute per order unless forced, so rider
 * pings do not become a Directions bill.
 */

const LIVE = ['created', 'confirmed', 'preparing', 'ready_for_pickup', 'reached_pickup', 'picked_up', 'reached_drop'];
const PICKED_UP = ['picked_up', 'reached_drop'];
const FOOD_READY = ['ready_for_pickup', 'reached_pickup'];

/** How often a ping may recompute an order's ETA. */
export const ETA_REFRESH_MS = 60 * 1000;
/** Kitchen time when no dish says how long it takes. */
export const DEFAULT_PREP_MINUTES = 15;
/** City speed for the straight-line fallback, and how much longer roads are. */
const FALLBACK_KMPH = 22;
const ROAD_FACTOR = 1.3;

/**
 * What a restaurant typed as prep time -> minutes, or null.
 * "15-20 min" -> 20 (the upper figure), "25" -> 25, "1 hr" / "1h" -> 60,
 * "1 hr 30 min" / "1h30m" -> 90, "1.5 hours" -> 90. Hours and minutes are
 * read separately: "1h" was taken as 1 minute and "1 hr 30 min" as 30 hours.
 */
export const parsePrepMinutes = (value) => {
    const text = String(value ?? '').toLowerCase();
    const unit = (re) => {
        const found = [...text.matchAll(re)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n) && n > 0);
        return found.length ? Math.max(...found) : null;
    };
    const hours = unit(/(\d+(?:\.\d+)?)\s*(?:hours|hour|hrs|hr|h)(?![a-z])/g);
    const mins = unit(/(\d+(?:\.\d+)?)\s*(?:minutes|minute|mins|min|m)(?![a-z])/g);
    let minutes;
    if (hours != null || mins != null) {
        minutes = (hours ?? 0) * 60 + (mins ?? 0);
    } else {
        const numbers = (text.match(/\d+(\.\d+)?/g) || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
        if (!numbers.length) return null;
        minutes = Math.max(...numbers);
    }
    return minutes > 0 && minutes <= 240 ? Math.round(minutes) : null;
};

/** A real position, or null -- 0,0 and out-of-range points are not (riderFix.toFix). */
const point = (lat, lng) => toFix(lat, lng);

/** Road minutes estimated from straight-line distance, for when Google has no route. */
export function estimateDriveMinutes(from, to) {
    if (!from || !to) return null;
    const km = haversineKm(from.lat, from.lng, to.lat, to.lng) * ROAD_FACTOR;
    return Number.isFinite(km) ? Math.max(1, Math.ceil((km / FALLBACK_KMPH) * 60)) : null;
}

/** Minutes to drive between two points, or null when either is unknown. */
export async function driveMinutes(from, to) {
    if (!from || !to) return null;
    try {
        const route = await fetchDrivingRoute(from, to);
        // No route comes back as durationSeconds: null, and Number(null) is 0 --
        // which made every un-routed leg "1 minute" and the ETA far too early.
        const seconds = route?.durationSeconds == null ? NaN : Number(route.durationSeconds);
        if (Number.isFinite(seconds) && seconds > 0) return Math.max(1, Math.ceil(seconds / 60));
    } catch {
        // Fall through to the estimate.
    }
    return estimateDriveMinutes(from, to);
}

/**
 * The ETA in minutes from `now`, from what is known about the order. Pure
 * apart from the drive times it is handed. Exported for the tests.
 */
export function etaMinutesFor({ status, prepMinutes, placedAt, now = new Date(), riderToRestaurant, restaurantToCustomer, riderToCustomer }) {
    if (PICKED_UP.includes(status)) return riderToCustomer ?? restaurantToCustomer ?? null;
    if (restaurantToCustomer == null) return null;
    const cooked = Math.max(0, (Number(now) - Number(new Date(placedAt))) / 60000);
    const kitchenLeft = FOOD_READY.includes(status) ? 0 : Math.max(0, Math.ceil(prepMinutes - cooked));
    return Math.max(kitchenLeft, riderToRestaurant ?? 0) + restaurantToCustomer;
}

const inFlight = new Set();

/**
 * Recomputes, saves and announces one order's ETA. Never throws.
 *
 * @param {string} orderId internal id
 * @param {{force?: boolean}} options force skips the once-a-minute limit (status changes)
 * @returns the new { etaMinutes, estimatedDeliveryAt }, or null when nothing was computed
 */
export async function refreshOrderEta(orderId, { force = false } = {}) {
    const id = String(orderId || '');
    if (!id || inFlight.has(id)) return null;
    inFlight.add(id);
    try {
        const order = await runUnscoped(() => prisma.foodOrder.findUnique({
            where: { id },
            select: {
                id: true, userId: true, orderStatus: true, createdAt: true, etaComputedAt: true,
                delayedUntil: true, promisedDeliveryAt: true,
                addrLat: true, addrLng: true, riderLat: true, riderLng: true,
                dispatchDeliveryPartnerId: true,
                restaurant: { select: { latitude: true, longitude: true } },
                deliveryPartner: { select: { lastLat: true, lastLng: true } },
                items: { select: { itemId: true } },
            },
        }));
        if (!order || !LIVE.includes(order.orderStatus)) return null;
        if (!force && order.etaComputedAt && Date.now() - new Date(order.etaComputedAt).getTime() < ETA_REFRESH_MS) {
            return null;
        }

        const customer = point(order.addrLat, order.addrLng);
        const restaurant = point(order.restaurant?.latitude, order.restaurant?.longitude);
        const rider = point(order.riderLat, order.riderLng)
            || (order.dispatchDeliveryPartnerId ? point(order.deliveryPartner?.lastLat, order.deliveryPartner?.lastLng) : null);
        const pickedUp = PICKED_UP.includes(order.orderStatus);

        // The slowest dish decides when the order is ready.
        let prepMinutes = DEFAULT_PREP_MINUTES;
        if (!pickedUp) {
            const itemIds = [...new Set(order.items.map((i) => i.itemId).filter(Boolean))];
            const foods = itemIds.length
                ? await prisma.foodItem.findMany({ where: { id: { in: itemIds } }, select: { preparationTime: true } })
                : [];
            const times = foods.map((f) => parsePrepMinutes(f.preparationTime)).filter((m) => m != null);
            if (times.length) prepMinutes = Math.max(...times);
        }

        const [riderToRestaurant, restaurantToCustomer, riderToCustomer] = await Promise.all([
            !pickedUp && rider ? driveMinutes(rider, restaurant) : null,
            pickedUp && rider ? null : driveMinutes(restaurant, customer),
            pickedUp && rider ? driveMinutes(rider, customer) : null,
        ]);

        const now = new Date();
        const computed = etaMinutesFor({
            status: order.orderStatus,
            prepMinutes,
            placedAt: order.createdAt,
            now,
            riderToRestaurant,
            restaurantToCustomer,
            riderToCustomer,
        });
        if (computed == null) return null;

        // A "running late" update told the customer a later time; the next
        // ping must not quietly pull it back (orderDelay.service.js).
        let estimatedDeliveryAt = new Date(now.getTime() + computed * 60000);
        if (order.delayedUntil && new Date(order.delayedUntil) > estimatedDeliveryAt) {
            estimatedDeliveryAt = new Date(order.delayedUntil);
        }
        const minutes = Math.max(0, Math.ceil((estimatedDeliveryAt.getTime() - now.getTime()) / 60000));
        await prisma.foodOrder.update({
            where: { id },
            data: {
                etaMinutes: minutes, estimatedDeliveryAt, etaComputedAt: now,
                // The first ETA is the promise the delay watchdog checks against.
                ...(order.promisedDeliveryAt ? {} : { promisedDeliveryAt: estimatedDeliveryAt }),
            },
        });

        const payload = {
            orderId: id,
            orderMongoId: id,
            orderStatus: order.orderStatus,
            etaMinutes: minutes,
            estimatedDeliveryAt: estimatedDeliveryAt.toISOString(),
        };
        try {
            const io = getIO();
            if (io) {
                io.to(rooms.user(order.userId)).emit('order_eta', payload);
                io.to(rooms.tracking(id)).emit('order_eta', payload);
            }
        } catch {
            // The next fetch carries it anyway.
        }
        return { etaMinutes: minutes, estimatedDeliveryAt };
    } catch (err) {
        logger.warn(`ETA refresh failed for order ${id}: ${err?.message || err}`);
        return null;
    } finally {
        inFlight.delete(id);
    }
}
