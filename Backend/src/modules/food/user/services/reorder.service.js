import { prisma } from '../../../../config/prisma.js';
import { isId } from '../../../../utils/helpers.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { restaurantsInReach } from '../../shared/deliveryRadius.js';
import { languageFromQuery, pickText } from '../../shared/language.js';
import { applyAppPricing } from '../../pricing/priceRules.service.js';
import { getFoodDisplayPrice, getFoodDisplayOtherPrice } from '../../admin/services/foodVariant.service.js';
import { restaurantCards } from '../../search/services/dishSearch.service.js';
import { restoreExpiredFoodAvailability } from '../../restaurant/services/foodAvailability.service.js';

/**
 * GET /food/user/reorder — the Reorder screen.
 *
 * The customer's own delivered orders, grouped by store, most recently
 * ordered store first. Each store lists the dishes the customer bought there,
 * each as it is *today*: current price (admin price rules applied), current
 * variants, availability. Nothing is silently swapped:
 *
 *  - a dish that was deleted, unapproved or moved stays in the list, disabled,
 *    with the name and image from the receipt and `unavailableReason`;
 *  - an out-of-stock dish stays, disabled, with `availableAgainAt` when known;
 *  - the variant chosen last time is matched by id, then by name; when neither
 *    exists any more `lastVariant.stillExists` is false and
 *    `needsVariantChoice` is true, so the app asks instead of guessing;
 *  - a closed store or one that does not deliver to the given point is still
 *    listed, with its reason, and its dishes are not addable (`canAdd`).
 *
 * The older flat GET /food/user/order-again is unchanged.
 */

const HISTORY_ORDERS = 100;
const MAX_ITEMS_PER_STORE = 30;

export const UNAVAILABLE_MESSAGES = Object.freeze({
    discontinued: 'No longer on the menu',
    out_of_stock: 'Out of stock',
    store_closed: 'Store is closed',
    not_deliverable: 'Does not deliver to your location',
});

const CLOSED_MESSAGES = {
    'not-accepting-orders': 'Not accepting orders right now',
    'closed-day': 'Closed today',
    'outside-hours': 'Closed now',
    'no-timings': 'Closed now',
};

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/** Order-line add-ons as stored ([{ addonId, name, price }]), tolerating junk. */
const lineAddons = (value) =>
    (Array.isArray(value) ? value : [])
        .map((a) => ({
            id: String(a?.addonId || a?.id || a?._id || ''),
            name: String(a?.name || '').trim(),
        }))
        .filter((a) => a.id || a.name);

/**
 * Walk the orders (newest first) into stores, each with its dishes. The first
 * line seen for a dish is the most recent one, so it supplies the variant,
 * add-ons and receipt name/image.
 */
export function groupHistory(orders = []) {
    const stores = new Map();
    for (const order of orders) {
        const rid = String(order.restaurantId || '');
        if (!isId(rid)) continue;
        let store = stores.get(rid);
        if (!store) {
            store = { restaurantId: rid, lastOrderedAt: order.createdAt, ordersCount: 0, items: new Map() };
            stores.set(rid, store);
        }
        store.ordersCount += 1;
        const seen = new Set();
        for (const line of order.items || []) {
            const foodId = String(line.itemId || '');
            if (!isId(foodId)) continue;
            let entry = store.items.get(foodId);
            if (!entry) {
                entry = {
                    foodId,
                    name: line.name || '',
                    image: line.image || '',
                    isVeg: line.isVeg !== false,
                    variantId: String(line.variantId || ''),
                    variantName: String(line.variantName || ''),
                    addons: lineAddons(line.addons),
                    previousPrice: Number(line.price) || 0,
                    lastQuantity: Number(line.quantity) || 1,
                    lastOrderedAt: order.createdAt,
                    timesOrdered: 0,
                };
                store.items.set(foodId, entry);
            }
            if (!seen.has(foodId)) {
                entry.timesOrdered += 1;
                seen.add(foodId);
            }
        }
    }
    return [...stores.values()].sort((a, b) => new Date(b.lastOrderedAt) - new Date(a.lastOrderedAt));
}

/** The variant chosen last time, matched to today's variants by id, then name. */
export function matchLastVariant(history, variants = []) {
    if (!history.variantId && !history.variantName) return null;
    const current =
        variants.find((v) => history.variantId && String(v.id) === history.variantId) ||
        variants.find((v) => history.variantName && sameName(v.name, history.variantName));
    if (current) {
        return {
            id: String(current.id),
            name: current.name,
            price: Number(current.price) || 0,
            otherPrice: Number(current.otherPrice) || 0,
            stillExists: true,
        };
    }
    return { id: history.variantId || null, name: history.variantName || '', price: null, otherPrice: null, stillExists: false };
}

/** Add-ons offered on a dish: restaurant-wide ones plus those linked to it. */
const addonsForFood = (addons, foodId) =>
    addons.filter((a) => !a.foodIds?.length || a.foodIds.includes(foodId));

/**
 * One dish card. `food` is today's priced row (variants included) or null when
 * it is gone; `store` is the store block it sits in.
 */
export function buildReorderItem(history, food, store, { lang = 'en', addons = [] } = {}) {
    const exists = Boolean(food) && food.restaurantId === store.id && food.approvalStatus === 'approved';
    const variants = exists
        ? (food.variants || []).map((v) => ({
              id: String(v.id),
              name: v.name,
              price: Number(v.price) || 0,
              otherPrice: Number(v.otherPrice) || 0,
          }))
        : [];
    const hasVariants = variants.length > 0;
    const lastVariant = exists
        ? matchLastVariant(history, variants)
        : history.variantId || history.variantName
            ? { id: history.variantId || null, name: history.variantName, price: null, otherPrice: null, stillExists: false }
            : null;

    const offered = exists ? addonsForFood(addons, food.id) : [];
    const offeredIds = new Set(offered.map((a) => a.id));
    const lastAddons = history.addons.map((a) => ({
        id: a.id || null,
        name: a.name,
        stillAvailable: Boolean(a.id) && offeredIds.has(a.id),
    }));

    let unavailableReason = null;
    if (!exists) unavailableReason = 'discontinued';
    else if (!food.isAvailable) unavailableReason = 'out_of_stock';
    const isAvailable = unavailableReason === null;

    let storeReason = null;
    if (!store.isDeliverable) storeReason = 'not_deliverable';
    else if (!store.isOpen) storeReason = 'store_closed';
    const blockedBy = unavailableReason || storeReason;

    let price = null;
    let otherPrice = null;
    if (exists) {
        if (lastVariant?.stillExists) {
            price = lastVariant.price;
            otherPrice = lastVariant.otherPrice;
        } else {
            price = Number(getFoodDisplayPrice(food)) || 0;
            otherPrice = Number(getFoodDisplayOtherPrice(food)) || 0;
        }
    }

    const foodType = exists ? (food.foodType === 'NonVeg' ? 'Non-Veg' : food.foodType || 'Non-Veg') : history.isVeg ? 'Veg' : 'Non-Veg';

    return {
        foodId: history.foodId,
        name: exists ? pickText(food.name, food.nameTe, lang) : history.name,
        nameEn: exists ? food.name : history.name,
        image: (exists && food.image) || history.image || '',
        description: exists ? pickText(food.description, food.descriptionTe, lang) || '' : '',
        price,
        otherPrice,
        /** True when price is the lowest variant's ("from ₹X"), not a chosen one. */
        priceIsFrom: hasVariants && !lastVariant?.stillExists,
        previousPrice: history.previousPrice,
        foodType,
        isVeg: foodType === 'Veg',
        isAvailable,
        unavailableReason,
        unavailableMessage: unavailableReason ? UNAVAILABLE_MESSAGES[unavailableReason] : null,
        availableAgainAt: unavailableReason === 'out_of_stock' ? food.stockResumeAt || null : null,
        canAdd: blockedBy === null,
        blockedReason: blockedBy,
        hasVariants,
        variants,
        lastVariant,
        needsVariantChoice: hasVariants && !lastVariant?.stillExists,
        hasAddons: offered.length > 0,
        lastAddons,
        lastQuantity: history.lastQuantity,
        timesOrdered: history.timesOrdered,
        lastOrderedAt: history.lastOrderedAt,
    };
}

const storeBlock = (card, history, deliverable) => ({
    id: card.id,
    name: card.name,
    slug: card.slug,
    image: card.image,
    rating: card.rating,
    totalRatings: card.totalRatings,
    pureVeg: card.pureVeg,
    deliveryTime: card.estimatedDeliveryTime,
    distanceKm: card.distanceKm,
    isOpen: Boolean(card.isOpenNow),
    closedReason: card.isOpenNow ? null : card.openStatusReason || 'closed',
    closedMessage: card.isOpenNow ? null : CLOSED_MESSAGES[card.openStatusReason] || 'Closed now',
    nextOpeningAt: card.nextOpeningAt || null,
    closingSoon: Boolean(card.closingSoon),
    closesInMinutes: card.closesInMinutes ?? null,
    isDeliverable: deliverable,
    ordersCount: history.ordersCount,
});

/**
 * query: lat, lng (optional; with them, stores out of reach are flagged
 * isDeliverable=false), restaurantId (one store only), lang, limit (stores, <= 50).
 */
export async function getReorderStores(userId, query = {}) {
    if (!isId(userId)) throw new ValidationError('Invalid user');
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 50);
    const lang = languageFromQuery(query);
    const onlyRestaurant = String(query.restaurantId || '').trim();
    if (onlyRestaurant && !isId(onlyRestaurant)) throw new ValidationError('Invalid restaurant id');

    const orders = await prisma.foodOrder.findMany({
        where: {
            userId: String(userId),
            orderStatus: 'delivered',
            ...(onlyRestaurant ? { restaurantId: onlyRestaurant } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_ORDERS,
        select: {
            id: true, restaurantId: true, createdAt: true,
            items: {
                select: {
                    itemId: true, name: true, image: true, isVeg: true, quantity: true, price: true,
                    variantId: true, variantName: true, addons: true,
                },
            },
        },
    });
    const history = groupHistory(orders);
    if (!history.length) return { stores: [] };

    let distanceById = null;
    let reachable = null;
    const reach = await restaurantsInReach({ lat: query.lat, lng: query.lng, radiusKm: query.radiusKm });
    if (!reach.requiresLocation) {
        distanceById = reach.distanceById;
        reachable = new Set(reach.distanceById.keys());
    }

    // Stores that are gone (deleted, suspended) are left out: there is nothing to open.
    const cards = await restaurantCards(history.map((h) => h.restaurantId), distanceById);
    const kept = history.filter((h) => cards.has(h.restaurantId)).slice(0, limit);
    if (!kept.length) return { stores: [] };

    const foodIds = [...new Set(kept.flatMap((h) => [...h.items.keys()]))];
    await restoreExpiredFoodAvailability({ id: { in: foodIds } });
    const foods = await prisma.foodItem.findMany({
        where: { id: { in: foodIds } },
        include: { variants: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
    });
    const priced = await applyAppPricing(foods);
    const foodById = new Map(priced.map((f) => [f.id, f]));

    const addonRows = await prisma.foodAddon.findMany({
        where: {
            restaurantId: { in: kept.map((h) => h.restaurantId) },
            isDeleted: false,
            approvalStatus: 'approved',
            isAvailable: true,
        },
        select: { id: true, restaurantId: true, foodIds: true, published: true },
    });
    const addonsByStore = new Map();
    for (const a of addonRows) {
        if (!a.published) continue;
        const list = addonsByStore.get(a.restaurantId) || [];
        list.push({ id: a.id, foodIds: (a.foodIds || []).map(String) });
        addonsByStore.set(a.restaurantId, list);
    }

    const stores = kept.map((h) => {
        const deliverable = !reachable || reachable.has(h.restaurantId);
        const restaurant = storeBlock(cards.get(h.restaurantId), h, deliverable);
        const items = [...h.items.values()]
            .map((entry) => buildReorderItem(entry, foodById.get(entry.foodId) || null, restaurant, {
                lang,
                addons: addonsByStore.get(h.restaurantId) || [],
            }))
            .sort((a, b) =>
                Number(b.isAvailable) - Number(a.isAvailable)
                || new Date(b.lastOrderedAt) - new Date(a.lastOrderedAt)
                || b.timesOrdered - a.timesOrdered)
            .slice(0, MAX_ITEMS_PER_STORE);
        return { restaurant, lastOrderedAt: h.lastOrderedAt, items };
    });

    return { stores };
}
