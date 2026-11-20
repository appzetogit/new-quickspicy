import { dayRange } from '../../../../utils/timezone.js';
import { prisma } from '../../../../config/prisma.js';
import { isId } from '../../../../utils/helpers.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { Prisma } from '@prisma/client';
import { calculateOrderPricing } from '../../orders/services/order-pricing.service.js';
import { applyAppPricing } from '../../pricing/priceRules.service.js';
import { getFoodDisplayPrice, getFoodDisplayOtherPrice } from '../../admin/services/foodVariant.service.js';
import { restaurantCards } from '../../search/services/dishSearch.service.js';

const toPositiveInt = (value, fallback = 1) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
};

const toNonNegativeNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
};

/**
 * The delivery-fee GST a stored cart already recorded.
 *
 * This used to invent 18% whenever the stored value was zero, which is a second
 * home for a rate that belongs in the fee settings — and it would have silently
 * put the charge back on every cart the moment it was switched off there. A
 * stored zero now means zero.
 */
const resolveStoredDeliveryFeeGst = (deliveryFee, deliveryFeeGst) => {
    if (toNonNegativeNumber(deliveryFee, 0) <= 0) return 0;
    return toNonNegativeNumber(deliveryFeeGst, 0);
};

const normalizeCartItems = (items = []) => {
    if (!Array.isArray(items)) return [];

    return items
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
            const quantity = toPositiveInt(item.quantity, 1);
            const price = toNonNegativeNumber(item.price ?? item.variantPrice, 0);
            const variantPrice = toNonNegativeNumber(item.variantPrice ?? item.price, price);

            return {
                lineItemId: String(item.lineItemId || item.id || ''),
                itemId: String(item.itemId || item.productId || item.id || ''),
                name: String(item.name || 'Item').trim(),
                price,
                otherPrice: (() => {
                    const other = toNonNegativeNumber(item.otherPrice, 0);
                    return other > price ? other : 0;
                })(),
                quantity,
                variantId: String(item.variantId || ''),
                variantName: String(item.variantName || ''),
                variantPrice,
                image: String(item.image || item.imageUrl || ''),
                foodType: String(item.foodType || ''),
                isVeg: item.isVeg === true || String(item.foodType || '').toLowerCase() === 'veg',
            };
        })
        .filter((item) => item.name && item.quantity > 0);
};

const normalizePricingSnapshot = (pricing = null) => {
    if (!pricing || typeof pricing !== 'object') return null;

    const subtotal = toNonNegativeNumber(pricing.subtotal, 0);
    const tax = toNonNegativeNumber(pricing.tax, 0);
    const packagingFee = toNonNegativeNumber(pricing.packagingFee, 0);
    const deliveryFee = toNonNegativeNumber(pricing.deliveryFee, 0);
    const deliveryFeeGst = resolveStoredDeliveryFeeGst(deliveryFee, pricing.deliveryFeeGst);
    const platformFee = toNonNegativeNumber(pricing.platformFee, 0);
    const discount = toNonNegativeNumber(pricing.discount, 0);
    const deliveryMode = pricing.deliveryMode === 'quick' ? 'quick' : 'basic';
    const quickDeliveryFee = toNonNegativeNumber(pricing.quickDeliveryFee, 0);
    const total = toNonNegativeNumber(
        pricing.total,
        subtotal + packagingFee + deliveryFee + deliveryFeeGst + platformFee + tax - discount,
    );
    const savings = toNonNegativeNumber(pricing.savings, 0);

    return {
        subtotal,
        tax,
        packagingFee,
        deliveryFee,
        deliveryFeeGst,
        platformFee,
        quickDeliveryFee,
        deliveryMode,
        discount,
        total,
        savings,
        couponCode: String(pricing.couponCode || pricing.appliedCoupon?.code || '').trim(),
        deliveryFeeBreakdown: pricing.deliveryFeeBreakdown || null,
        appliedCoupon: pricing.appliedCoupon || null,
    };
};

const mapCartItemsForPricing = (items = []) =>
    items.map((item) => ({
        itemId: item.itemId,
        id: item.itemId,
        price: item.price,
        quantity: item.quantity,
        variantId: item.variantId || undefined,
        variantName: item.variantName || undefined,
        variantPrice: item.variantPrice || item.price,
        name: item.name,
    }));

async function enrichStoredCartPricing(cart, storedPricing) {
    if (!storedPricing || typeof storedPricing !== 'object') return storedPricing;

    const storedDelivery = toNonNegativeNumber(storedPricing.deliveryFee, 0);
    if (storedDelivery > 0) {
        return {
            ...storedPricing,
            deliveryFeeGst: resolveStoredDeliveryFeeGst(storedDelivery, storedPricing.deliveryFeeGst),
        };
    }

    if (!isId(cart.restaurantId)) return storedPricing;

    try {
        const result = await calculateOrderPricing(
            cart.userId,
            {
                restaurantId: cart.restaurantId,
                items: mapCartItemsForPricing(cart.items),
            },
            { skipAvailabilityCheck: true },
        );
        const recalc = result?.pricing;
        if (!recalc) return storedPricing;

        const recalcDelivery = toNonNegativeNumber(recalc.deliveryFee, 0);
        const recalcDeliveryGst = toNonNegativeNumber(recalc.deliveryFeeGst, 0);
        if (recalcDelivery <= 0) return storedPricing;

        const subtotal = toNonNegativeNumber(storedPricing.subtotal, Number(cart.subtotal) || 0);
        const platformFee = toNonNegativeNumber(
            storedPricing.platformFee,
            toNonNegativeNumber(recalc.platformFee, 0),
        );
        const tax = toNonNegativeNumber(storedPricing.tax, toNonNegativeNumber(recalc.tax, 0));
        const discount = toNonNegativeNumber(storedPricing.discount, 0);
        const total = Math.max(0, subtotal + recalcDelivery + recalcDeliveryGst + platformFee + tax - discount);

        return {
            ...storedPricing,
            deliveryFee: recalcDelivery,
            deliveryFeeGst: recalcDeliveryGst,
            deliveryFeeBreakdown: recalc.deliveryFeeBreakdown || storedPricing.deliveryFeeBreakdown || null,
            total,
        };
    } catch {
        return storedPricing;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Multiple carts: one cart per (customer, restaurant).
//
// A customer can keep a cart open at several restaurants at once. Each is its
// own row, keyed by (userId, restaurantId). Checkout stays one restaurant per
// order and reads the items the app sends, so ordering from one cart leaves
// the others untouched; the app deletes the cart it checked out.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_LINE_QUANTITY = 99;
const MAX_CARTS_LISTED = 50;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Same line id the web app builds: `<itemId>::<variantId | base>`. */
export const cartLineId = (itemId, variantId = '') =>
    `${String(itemId || '')}::${String(variantId || '') || 'base'}`;

const isSameLine = (line, itemId, variantId = '') =>
    String(line.itemId) === String(itemId) && String(line.variantId || '') === String(variantId || '');

const cartTotals = (items) => ({
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: round2(items.reduce((sum, item) => sum + item.price * item.quantity, 0)),
});

const requireUserId = (userId) => {
    if (!isId(userId)) throw new ValidationError('Invalid user');
    return String(userId);
};

const requireRestaurantId = (restaurantId) => {
    if (!isId(restaurantId)) throw new ValidationError('Invalid restaurant');
    return String(restaurantId);
};

async function restaurantNameFor(restaurantId) {
    if (!isId(restaurantId)) return '';
    const restaurant = await prisma.foodRestaurant.findUnique({
        where: { id: String(restaurantId) },
        select: { restaurantName: true },
    });
    return restaurant?.restaurantName || '';
}

/** The customer's most recently changed cart (what the single-cart endpoints act on). */
export async function getLatestCartRow(userId) {
    return prisma.foodUserCart.findFirst({
        where: { userId: requireUserId(userId), itemCount: { gt: 0 } },
        orderBy: { updatedAt: 'desc' },
    });
}

/** Replace one restaurant's cart wholesale; an empty list deletes it. */
async function writeCart(userId, restaurantId, rawItems, rawPricing, restaurantNameHint = '') {
    const items = normalizeCartItems(rawItems);
    if (items.length === 0) {
        // deleteMany, not delete: emptying a cart that was never saved is a
        // no-op, not a missing-record error.
        await prisma.foodUserCart.deleteMany({ where: { userId, restaurantId } });
        return null;
    }

    // The user app sends only the restaurant id, so the name was saved blank
    // and the admin User Carts list showed an empty restaurant column.
    const restaurantName = String(restaurantNameHint || '').trim() || (await restaurantNameFor(restaurantId));
    const data = {
        restaurantName,
        // A cart is replaced wholesale and never queried across users, so
        // items and pricing stay snapshots rather than tables.
        items,
        ...cartTotals(items),
        pricing: normalizePricingSnapshot(rawPricing) ?? undefined,
    };

    return prisma.foodUserCart.upsert({
        where: { userId_restaurantId: { userId, restaurantId } },
        create: { userId, restaurantId, ...data },
        update: data,
    });
}

/**
 * Save the cart the app holds (PUT /cart and PUT /carts/:restaurantId).
 *
 * options.restaurantId names the cart. Without it (the old single-cart app),
 * items go to the cart of their own restaurantId (the first item's when an
 * item has none), so one call can never overwrite another restaurant's cart.
 * An empty list deletes the named cart, or without a name the most recently
 * changed one: the old app empties "the" cart after an order.
 *
 * Returns the last cart row written, or null when a cart was deleted.
 */
export async function syncUserCart(userId, rawItems = [], rawPricing = null, options = {}) {
    const id = requireUserId(userId);
    const list = Array.isArray(rawItems) ? rawItems.filter((item) => item && typeof item === 'object') : [];
    const explicit = options?.restaurantId != null && String(options.restaurantId) !== ''
        ? String(options.restaurantId)
        : null;

    if (list.length === 0) {
        const target = explicit ?? (await getLatestCartRow(id))?.restaurantId;
        if (target == null) return null;
        await prisma.foodUserCart.deleteMany({ where: { userId: id, restaurantId: target } });
        return null;
    }

    const nameOf = (item) =>
        String((typeof item.restaurant === 'string' ? item.restaurant : '') || item.restaurantName || '').trim();
    const groups = new Map();
    for (const item of list) {
        const own = String(item.restaurantId || '');
        // A dish from another restaurant never lands in the named cart.
        if (explicit && own && own !== explicit) continue;
        const restaurantId = explicit ?? (own || String(list[0].restaurantId || ''));
        if (!groups.has(restaurantId)) groups.set(restaurantId, { items: [], name: '' });
        const group = groups.get(restaurantId);
        group.items.push(item);
        if (!group.name) group.name = nameOf(item);
    }

    let last = null;
    for (const [restaurantId, group] of groups) {
        // A pricing snapshot describes one cart, so it is only kept when the
        // call is about one restaurant.
        last = await writeCart(
            id,
            restaurantId,
            group.items,
            groups.size === 1 ? rawPricing : null,
            group.name || options?.restaurantName || '',
        );
    }
    return last;
}

/** A cart row as the user API returns it. `card` is the restaurant summary, if still listed. */
export function toCartResponse(row, card = null) {
    if (!row) return null;
    const items = (Array.isArray(row.items) ? row.items : []).map((item) => ({
        ...item,
        lineItemId: item.lineItemId || cartLineId(item.itemId, item.variantId),
    }));
    const restaurantName = card?.name || row.restaurantName || '';
    return {
        id: row.id,
        restaurantId: row.restaurantId || '',
        restaurantName,
        restaurant: card
            ? { ...card }
            : { id: row.restaurantId || '', name: restaurantName, slug: null, image: null, isOpenNow: false },
        // False when the restaurant is no longer approved; checkout will refuse it.
        restaurantAvailable: Boolean(card),
        items,
        itemCount: Number(row.itemCount) || 0,
        subtotal: Number(row.subtotal) || 0,
        pricing: row.pricing ? normalizePricingSnapshot(row.pricing) : null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

async function withRestaurantCards(rows) {
    const ids = [...new Set(rows.map((row) => row.restaurantId).filter(isId))];
    const cards = ids.length ? await restaurantCards(ids, null) : new Map();
    return rows.map((row) => toCartResponse(row, cards.get(row.restaurantId) || null));
}

/** GET /carts: every open cart, most recently changed first. */
export async function listUserCarts(userId) {
    const id = requireUserId(userId);
    const rows = await prisma.foodUserCart.findMany({
        // Carts saved before restaurants were required have no restaurant to
        // open or order from; they stay in the table (and the admin list).
        where: { userId: id, itemCount: { gt: 0 }, restaurantId: { not: '' } },
        orderBy: { updatedAt: 'desc' },
        take: MAX_CARTS_LISTED,
    });
    const carts = await withRestaurantCards(rows);
    return {
        carts,
        count: carts.length,
        totalItems: carts.reduce((sum, cart) => sum + cart.itemCount, 0),
        latestRestaurantId: carts[0]?.restaurantId || null,
    };
}

/** GET /carts/:restaurantId. `cart` is null when there is none. */
export async function getUserCart(userId, restaurantId) {
    const row = await prisma.foodUserCart.findUnique({
        where: { userId_restaurantId: { userId: requireUserId(userId), restaurantId: requireRestaurantId(restaurantId) } },
    });
    if (!row || !(row.itemCount > 0)) return { cart: null };
    const [cart] = await withRestaurantCards([row]);
    return { cart };
}

/** GET /cart (single-cart clients): the named restaurant's cart, else the latest. */
export async function getLatestUserCart(userId, restaurantId = null) {
    if (restaurantId) return getUserCart(userId, restaurantId);
    const row = await getLatestCartRow(userId);
    if (!row) return { cart: null };
    const [cart] = await withRestaurantCards([row]);
    return { cart };
}

/** PUT /carts/:restaurantId: replace that cart's items (empty list deletes it). */
export async function replaceUserCart(userId, restaurantId, rawItems = [], rawPricing = null) {
    const rid = requireRestaurantId(restaurantId);
    const items = (Array.isArray(rawItems) ? rawItems : []).map((item) => ({
        ...item,
        restaurantId: item?.restaurantId || rid,
    }));
    const row = await syncUserCart(userId, items, rawPricing, { restaurantId: rid });
    if (!row) return { cart: null };
    const [cart] = await withRestaurantCards([row]);
    return { cart };
}

/** DELETE /carts/:restaurantId */
export async function deleteUserCart(userId, restaurantId) {
    const rid = requireRestaurantId(restaurantId);
    const { count } = await prisma.foodUserCart.deleteMany({ where: { userId: requireUserId(userId), restaurantId: rid } });
    return { deleted: count > 0, restaurantId: rid };
}

/** DELETE /carts: every cart the customer has. */
export async function clearUserCarts(userId) {
    const { count } = await prisma.foodUserCart.deleteMany({ where: { userId: requireUserId(userId) } });
    return { deleted: count };
}

/** One cart line priced from the menu now (app price rules applied), never from the client. */
async function priceDishForCart(restaurantId, itemId, variantId = '') {
    if (!isId(itemId)) throw new ValidationError('Invalid dish');
    const food = await prisma.foodItem.findFirst({
        where: { id: String(itemId), restaurantId },
        include: { variants: true },
    });
    if (!food || food.approvalStatus !== 'approved') throw new NotFoundError('Dish not found at this restaurant');
    if (!food.isAvailable) throw new ValidationError(`${food.name} is not available right now`);

    const [priced] = await applyAppPricing([food]);
    const variants = Array.isArray(priced?.variants) ? priced.variants : [];
    let variant = null;
    if (variantId) {
        variant = variants.find((entry) => String(entry.id) === String(variantId)) || null;
        if (!variant) throw new NotFoundError('That option is not available any more');
    } else if (variants.length > 0) {
        throw new ValidationError('Choose an option for this dish');
    }

    const price = round2(variant ? Number(variant.price) : getFoodDisplayPrice(priced));
    const otherPrice = round2(variant ? Number(variant.otherPrice) : getFoodDisplayOtherPrice(priced));
    const foodType = food.foodType === 'NonVeg' ? 'Non-Veg' : String(food.foodType || '');
    return {
        lineItemId: cartLineId(food.id, variant?.id),
        itemId: food.id,
        name: food.name,
        price,
        otherPrice: otherPrice > price ? otherPrice : 0,
        variantId: variant ? String(variant.id) : '',
        variantName: variant?.name || '',
        variantPrice: price,
        image: food.image || '',
        foodType,
        isVeg: foodType === 'Veg',
    };
}

const toQuantity = (value, { allowZero = false } = {}) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < (allowZero ? 0 : 1) || parsed > MAX_LINE_QUANTITY) {
        throw new ValidationError(`Quantity must be a whole number from ${allowZero ? 0 : 1} to ${MAX_LINE_QUANTITY}`);
    }
    return parsed;
};

/**
 * Change one restaurant's cart under a row lock, so two quick taps cannot
 * both read the old items and lose one update. `change` gets the current
 * lines and returns the new ones; an empty result deletes the cart.
 */
async function mutateCart(userId, restaurantId, change) {
    const restaurantName = await restaurantNameFor(restaurantId);
    const row = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
            INSERT INTO "food_user_carts" ("userId", "restaurantId", "restaurantName", "updatedAt")
            VALUES (${userId}, ${restaurantId}, ${restaurantName}, now())
            ON CONFLICT ("userId", "restaurantId") DO NOTHING`;
        await tx.$queryRaw`
            SELECT "id" FROM "food_user_carts"
            WHERE "userId" = ${userId} AND "restaurantId" = ${restaurantId}
            FOR UPDATE`;
        const current = await tx.foodUserCart.findUnique({
            where: { userId_restaurantId: { userId, restaurantId } },
        });
        const next = normalizeCartItems(change(normalizeCartItems(current.items)));
        if (next.length === 0) {
            await tx.foodUserCart.delete({ where: { id: current.id } });
            return null;
        }
        return tx.foodUserCart.update({
            where: { id: current.id },
            data: {
                items: next,
                ...cartTotals(next),
                restaurantName: current.restaurantName || restaurantName,
                // The stored quote was for the old items.
                pricing: Prisma.DbNull,
            },
        });
    });
    if (!row) return { cart: null };
    const [cart] = await withRestaurantCards([row]);
    return { cart };
}

/** POST /carts/:restaurantId/items: add a dish (or more of it). Creates the cart if needed. */
export async function addUserCartItem(userId, restaurantId, body = {}) {
    const uid = requireUserId(userId);
    const rid = requireRestaurantId(restaurantId);
    const quantity = toQuantity(body.quantity ?? 1);
    const line = await priceDishForCart(rid, body.itemId, body.variantId || '');
    return mutateCart(uid, rid, (items) => {
        const existing = items.find((item) => isSameLine(item, line.itemId, line.variantId));
        if (!existing) return [...items, { ...line, quantity }];
        return items.map((item) => (item === existing
            // Today's price, not the one from when it was first added.
            ? { ...item, ...line, quantity: Math.min(MAX_LINE_QUANTITY, item.quantity + quantity) }
            : item));
    });
}

/** PATCH /carts/:restaurantId/items/:itemId: set a line's quantity; 0 removes it. */
export async function updateUserCartItem(userId, restaurantId, itemId, body = {}) {
    const uid = requireUserId(userId);
    const rid = requireRestaurantId(restaurantId);
    const quantity = toQuantity(body.quantity, { allowZero: true });
    const variantId = String(body.variantId || '');
    return mutateCart(uid, rid, (items) => {
        if (!items.some((item) => isSameLine(item, itemId, variantId))) throw new NotFoundError('That dish is not in this cart');
        return quantity === 0
            ? items.filter((item) => !isSameLine(item, itemId, variantId))
            : items.map((item) => (isSameLine(item, itemId, variantId) ? { ...item, quantity } : item));
    });
}

/** DELETE /carts/:restaurantId/items/:itemId[?variantId=] */
export async function removeUserCartItem(userId, restaurantId, itemId, variantId = '') {
    const uid = requireUserId(userId);
    const rid = requireRestaurantId(restaurantId);
    return mutateCart(uid, rid, (items) => {
        if (!items.some((item) => isSameLine(item, itemId, variantId))) throw new NotFoundError('That dish is not in this cart');
        return items.filter((item) => !isSameLine(item, itemId, variantId));
    });
}

const CART_SORTS_BY_ORDER_HISTORY = new Set(['orders-desc', 'orders-asc', 'value-desc', 'value-asc']);

/** Delivered orders per customer: how many, and what they came to. */
async function orderStatsByUser(userIds = []) {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return new Map();
    const rows = await prisma.foodOrder.groupBy({
        by: ['userId'],
        where: { userId: { in: ids }, orderStatus: 'delivered' },
        _count: { _all: true },
        _sum: { total: true },
    });
    return new Map(rows.map((row) => [row.userId, {
        totalOrders: row._count._all,
        totalOrderValue: Math.round((Number(row._sum.total) || 0) * 100) / 100,
    }]));
}

export async function listUserCartsForAdmin(query = {}) {
    const page = Math.max(1, toPositiveInt(query.page, 1));
    const limit = Math.min(100, Math.max(1, toPositiveInt(query.limit, 20)));
    const skip = (page - 1) * limit;
    const search = String(query.search || '').trim();

    // itemCount is maintained on every sync, so "has items" is a plain column
    // test rather than probing for the existence of items[0].
    const where = { itemCount: { gt: 0 } };
    // From/to, as whole India days; the list had no date filter.
    const range = dayRange(query);
    if (range) where.updatedAt = range;

    if (search) {
        // The customer is matched through the relation instead of pre-resolving
        // up to 200 ids and hoping the real match falls inside that slice.
        where.OR = [
            { restaurantName: { contains: search, mode: 'insensitive' } },
            { restaurantId: { contains: search, mode: 'insensitive' } },
            { user: { name: { contains: search, mode: 'insensitive' } } },
            { user: { phone: { contains: search, mode: 'insensitive' } } },
            { user: { email: { contains: search, mode: 'insensitive' } } },
        ];
    }

    if (isId(query.restaurantId)) where.restaurantId = String(query.restaurantId);

    const sortBy = String(query.sortBy || 'recent');
    const userInclude = { user: { select: { id: true, name: true, phone: true, email: true, profileImage: true } } };

    let carts;
    let total;
    let statsByUser;

    if (CART_SORTS_BY_ORDER_HISTORY.has(sortBy)) {
        // Sorting by what each customer has ordered needs every matching cart's
        // order history before the page can be cut. Open carts number in the
        // hundreds, not millions, so this is two small queries.
        const all = await prisma.foodUserCart.findMany({
            where,
            select: { id: true, userId: true, updatedAt: true },
            orderBy: { updatedAt: 'desc' },
            take: 5000,
        });
        total = all.length;
        statsByUser = await orderStatsByUser(all.map((c) => c.userId));
        const key = sortBy.startsWith('orders') ? 'totalOrders' : 'totalOrderValue';
        const dir = sortBy.endsWith('asc') ? 1 : -1;
        all.sort((a, b) =>
            dir * ((statsByUser.get(a.userId)?.[key] || 0) - (statsByUser.get(b.userId)?.[key] || 0))
            || b.updatedAt - a.updatedAt);
        const pageIds = all.slice(skip, skip + limit).map((c) => c.id);
        const rows = await prisma.foodUserCart.findMany({ where: { id: { in: pageIds } }, include: userInclude });
        const byId = new Map(rows.map((row) => [row.id, row]));
        carts = pageIds.map((id) => byId.get(id)).filter(Boolean);
    } else {
        const orderBy = {
            'cart-desc': { subtotal: 'desc' },
            'cart-asc': { subtotal: 'asc' },
        }[sortBy] || { updatedAt: 'desc' };
        [carts, total] = await Promise.all([
            prisma.foodUserCart.findMany({ where, include: userInclude, orderBy, skip, take: limit }),
            prisma.foodUserCart.count({ where }),
        ]);
        statsByUser = await orderStatsByUser(carts.map((c) => c.userId));
    }

    // Carts saved before the name was filled in on sync.
    const missingNameIds = [...new Set(carts.filter((c) => !c.restaurantName && isId(c.restaurantId)).map((c) => c.restaurantId))];
    const namesById = missingNameIds.length
        ? new Map((await prisma.foodRestaurant.findMany({
            where: { id: { in: missingNameIds } },
            select: { id: true, restaurantName: true },
        })).map((r) => [r.id, r.restaurantName]))
        : new Map();

    const normalized = await Promise.all(
        carts.map(async (cart) => {
            const user = cart.user || null;
            let pricing = cart.pricing || null;
            if (pricing) {
                pricing = normalizePricingSnapshot(pricing);
            }
            if (pricing && Number(pricing.deliveryFee) === 0) {
                pricing = normalizePricingSnapshot(await enrichStoredCartPricing(cart, pricing));
            }

            return {
                id: cart.id,
                userId: user?.id || cart.userId || '',
                userName: user?.name || 'Unknown user',
                userPhone: user?.phone || '',
                userEmail: user?.email || '',
                userImage: user?.profileImage || '',
                restaurantId: cart.restaurantId || '',
                restaurantName: cart.restaurantName || namesById.get(cart.restaurantId) || '',
                // How much this customer has ordered from us so far.
                totalOrders: statsByUser.get(cart.userId)?.totalOrders || 0,
                totalOrderValue: statsByUser.get(cart.userId)?.totalOrderValue || 0,
                items: Array.isArray(cart.items) ? cart.items : [],
                itemCount: Number(cart.itemCount) || 0,
                subtotal: Number(cart.subtotal) || 0,
                pricing,
                updatedAt: cart.updatedAt,
                createdAt: cart.createdAt,
            };
        }),
    );

    return {
        carts: normalized,
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
    };
}

export async function getUserCartPricingForAdmin(cartId) {
    if (!isId(cartId)) throw new ValidationError('Invalid cart id');

    const cart = await prisma.foodUserCart.findUnique({ where: { id: String(cartId) } });
    if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
        throw new NotFoundError('Cart not found');
    }

    if (cart.pricing && Number(cart.pricing.total) > 0) {
        const enriched = await enrichStoredCartPricing(cart, cart.pricing);
        return normalizePricingSnapshot(enriched) || enriched;
    }

    if (!isId(cart.restaurantId)) {
        const subtotal = Number(cart.subtotal) || 0;
        return {
            subtotal,
            tax: 0,
            packagingFee: 0,
            deliveryFee: 0,
            platformFee: 0,
            discount: 0,
            total: subtotal,
            savings: 0,
            couponCode: '',
            deliveryFeeBreakdown: null,
            appliedCoupon: null,
        };
    }

    const result = await calculateOrderPricing(
        cart.userId,
        {
            restaurantId: cart.restaurantId,
            items: mapCartItemsForPricing(cart.items),
            couponCode: cart.pricing?.couponCode || undefined,
            deliveryMode: cart.pricing?.deliveryMode === 'quick' ? 'quick' : 'basic',
        },
        { skipAvailabilityCheck: true },
    );

    const recalc = result?.pricing || null;
    if (!recalc) return null;

    const deliveryMode = cart.pricing?.deliveryMode === 'quick' ? 'quick' : 'basic';
    const quickDeliveryFee =
        deliveryMode === 'quick'
            ? toNonNegativeNumber(recalc.quickDeliveryFee, 0)
            : 0;

    return {
        ...recalc,
        quickDeliveryFee,
        deliveryMode,
        couponCode: cart.pricing?.couponCode || recalc.couponCode || '',
        appliedCoupon: recalc.appliedCoupon || cart.pricing?.appliedCoupon || null,
    };
}
