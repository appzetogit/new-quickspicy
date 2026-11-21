import { prisma } from '../../../../config/prisma.js';
import { isId } from '../../../../utils/helpers.js';
import { restaurantsInReach } from '../../shared/deliveryRadius.js';
import { verticalFilterFromQuery } from '../../shared/verticals.js';
import { languageFromQuery, pickText } from '../../shared/language.js';
import { applyAppPricing } from '../../pricing/priceRules.service.js';
import { getFoodDisplayPrice, getFoodDisplayOtherPrice } from '../../admin/services/foodVariant.service.js';
import { attachOutletTimingsToRestaurants } from '../../restaurant/services/outletTimings.service.js';
import { withOpenStatus } from '../../restaurant/helpers/restaurantAvailability.helper.js';
import { restoreExpiredFoodAvailability } from '../../restaurant/services/foodAvailability.service.js';
import { foodTypeWhereFromQuery, fromFoodTypeColumn } from '../../shared/foodType.util.js';
import { toRestaurant } from '../../restaurant/restaurant.mapper.js';
import { openFirst } from '../../shared/openFirst.js';

/**
 * Dish-level search and type-ahead suggestions.
 *
 * The unified search answers "which restaurants", one matched dish each. This
 * answers "which dishes": every orderable dish that matches, at the price the
 * customer will pay, from restaurants that deliver to them -- so it can be
 * sorted and filtered by price.
 */

export const SUGGEST_MIN_CHARS = 3;
const MAX_CANDIDATES = 600;

const toNumber = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

/** The search text, trimmed and capped. */
const term = (value) => String(value ?? '').trim().slice(0, 80);

/**
 * Restaurants the customer can order from, narrowed to a vertical when asked.
 * Returns { ids, distanceById } or { empty } / { requiresLocation }.
 */
const reachableRestaurants = async (query) => {
    const reach = await restaurantsInReach({ lat: query.lat, lng: query.lng, radiusKm: query.radiusKm });
    if (reach.requiresLocation) return { requiresLocation: true };
    let ids = [...reach.distanceById.keys()];
    if (!ids.length) return { empty: true };

    const pick = await verticalFilterFromQuery(query);
    if (pick.none) return { empty: true };
    if (pick.filter) {
        const rows = await prisma.foodRestaurant.findMany({
            where: { id: { in: ids }, status: 'approved', ...pick.filter },
            select: { id: true },
        });
        ids = rows.map((r) => r.id);
        if (!ids.length) return { empty: true };
    }
    return { ids, distanceById: reach.distanceById };
};

const RESTAURANT_SELECT = {
    id: true, restaurantName: true, nameSlug: true, profileImage: true, rating: true, totalRatings: true,
    isAcceptingOrders: true, openingTime: true, closingTime: true, openDays: true, pureVegRestaurant: true,
    estimatedDeliveryTime: true, estimatedDeliveryTimeMinutes: true, status: true,
};

/** Compact restaurant cards with open status, keyed by id. Shared with order-again. */
export const restaurantCards = async (ids, distanceById) => {
    const rows = await prisma.foodRestaurant.findMany({
        where: { id: { in: [...new Set(ids)] }, status: 'approved' },
        select: RESTAURANT_SELECT,
    });
    const withTimings = await attachOutletTimingsToRestaurants(rows);
    return new Map(withTimings.map((r) => {
        const s = withOpenStatus(r);
        return [r.id, {
            id: r.id,
            name: r.restaurantName,
            slug: r.nameSlug || null,
            image: r.profileImage || null,
            rating: Number(r.rating) || 0,
            totalRatings: Number(r.totalRatings) || 0,
            pureVeg: r.pureVegRestaurant === true,
            estimatedDeliveryTime: r.estimatedDeliveryTime || null,
            distanceKm: distanceById?.get(r.id) ?? null,
            isOpenNow: s.isOpenNow,
            openStatusReason: s.openStatusReason,
            closingSoon: s.closingSoon,
            closesInMinutes: s.closesInMinutes,
            nextOpeningAt: s.nextOpeningAt,
        }];
    }));
};

const SORTS = {
    'price-low': (a, b) => a.price - b.price,
    'price-high': (a, b) => b.price - a.price,
    rating: (a, b) => b.rating - a.rating || b.totalRatings - a.totalRatings,
    distance: (a, b) => (a.restaurant.distanceKm ?? Infinity) - (b.restaurant.distanceKm ?? Infinity),
};

/**
 * GET /food/search/dishes
 *
 * q (>= 2 chars), lat, lng (required), categoryId, verticalId | vertical,
 * isVeg=true (Egg excluded), foodType=Veg|Egg|Non-Veg, minPrice, maxPrice, minRating, openOnly=true,
 * sortBy = relevance (default) | price-low | price-high | rating | distance,
 * lang, page, limit (<= 50).
 */
export async function searchDishes(query = {}) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 50);
    const q = term(query.q);
    const lang = languageFromQuery(query);
    const empty = (extra = {}) => ({ items: [], total: 0, page, limit, ...extra });

    if (q.length < 2 && !isId(query.categoryId)) return empty({ minChars: 2 });

    const reach = await reachableRestaurants(query);
    if (reach.requiresLocation) return empty({ requiresLocation: true });
    if (reach.empty) return empty();

    await restoreExpiredFoodAvailability({ restaurantId: { in: reach.ids } });

    const AND = [
        { restaurantId: { in: reach.ids } },
        { approvalStatus: 'approved' },
        { isAvailable: true },
    ];
    if (q) {
        AND.push({
            OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { nameTe: { contains: q, mode: 'insensitive' } },
                { categoryName: { contains: q, mode: 'insensitive' } },
            ],
        });
    }
    if (isId(query.categoryId)) AND.push({ categoryId: String(query.categoryId) });
    // isVeg=true: Veg only (Egg excluded); foodType=Veg|Egg|Non-Veg (comma list).
    const typeWhere = foodTypeWhereFromQuery(query);
    if (typeWhere) AND.push(typeWhere);

    const raw = await prisma.foodItem.findMany({
        where: { AND },
        include: { variants: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
        take: MAX_CANDIDATES,
    });
    if (!raw.length) return empty();

    // The customer's price (admin price rules) before any price filter or sort.
    const priced = await applyAppPricing(raw);
    const restaurants = await restaurantCards(priced.map((f) => f.restaurantId), reach.distanceById);

    const minPrice = toNumber(query.minPrice);
    const maxPrice = toNumber(query.maxPrice);
    const minRating = toNumber(query.minRating);
    const needle = q.toLowerCase();

    let items = priced
        .map((food) => {
            const restaurant = restaurants.get(food.restaurantId);
            if (!restaurant) return null;
            const name = String(food.name || '');
            const lower = name.toLowerCase();
            return {
                id: food.id,
                name: pickText(name, food.nameTe, lang),
                nameEn: name,
                nameTe: food.nameTe || '',
                description: pickText(food.description || '', food.descriptionTe, lang),
                categoryId: food.categoryId || null,
                categoryName: food.categoryName || '',
                price: Number(getFoodDisplayPrice(food)) || 0,
                otherPrice: Number(getFoodDisplayOtherPrice(food)) || 0,
                hasVariants: Array.isArray(food.variants) && food.variants.length > 0,
                image: food.image || '',
                // Same value the menu endpoint returns for the same dish.
                foodType: food.foodType || 'Non-Veg',
                isVeg: food.foodType === 'Veg',
                rating: Number(food.rating) || 0,
                totalRatings: Number(food.totalRatings) || 0,
                restaurant,
                // relevance: exact name, then name starts with the term, then the rest
                relevance: !needle ? 0 : lower === needle ? 3 : lower.startsWith(needle) ? 2 : lower.includes(needle) ? 1 : 0,
            };
        })
        .filter(Boolean)
        .filter((item) => minPrice === null || item.price >= minPrice)
        .filter((item) => maxPrice === null || item.price <= maxPrice)
        .filter((item) => minRating === null || item.rating >= minRating)
        .filter((item) => query.openOnly !== 'true' || item.restaurant.isOpenNow);

    const within = SORTS[String(query.sortBy || '')] || ((a, b) =>
        b.relevance - a.relevance
        || (a.restaurant.distanceKm ?? Infinity) - (b.restaurant.distanceKm ?? Infinity));
    // Dishes from open restaurants always come before closed ones.
    items.sort((a, b) => Number(b.restaurant.isOpenNow) - Number(a.restaurant.isOpenNow) || within(a, b));

    const total = items.length;
    items = items.slice((page - 1) * limit, page * limit).map(({ relevance, ...rest }) => rest);
    return { items, total, page, limit };
}


// ----- Dish varieties and "restaurants serving <dish>" -----

/** Most dishes considered when grouping varieties or listing restaurants. */
const MAX_MATCH_ROWS = 1500;
/** Shortest query the restaurants-serving listing answers. */
export const DISH_RESTAURANTS_MIN_CHARS = 2;

/**
 * A dish name for grouping: trimmed, inner spaces collapsed, lower case.
 * "Chicken  Biryani ", "chicken biryani" and "CHICKEN BIRYANI" are one variety.
 */
export const normalizeDishName = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Display spelling of a name: trimmed, inner spaces collapsed, case kept. */
const tidyName = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');

/**
 * openOnly for the variety counts and the restaurants-serving listing defaults
 * to true: only restaurants that can take an order right now. openOnly=false
 * also lists closed ones (after the open ones).
 */
const openOnlyDefaultOn = (query) => String(query.openOnly ?? 'true').toLowerCase() !== 'false';

/** Relevance of a dish name to the needle: exact 3, prefix 2, contains 1. */
const nameRelevance = (name, needle) => {
    const n = normalizeDishName(name);
    if (!needle || !n) return 0;
    if (n === needle) return 3;
    if (n.startsWith(needle)) return 2;
    return n.includes(needle) ? 1 : 0;
};

/** Columns the restaurant cards need, plus the address columns toRestaurant() rebuilds `location` from. */
const LISTING_SELECT = {
    id: true, restaurantName: true, nameSlug: true, cuisines: true, profileImage: true, coverImages: true,
    estimatedDeliveryTime: true, estimatedDeliveryTimeMinutes: true, offer: true, featuredDish: true,
    featuredPrice: true, rating: true, totalRatings: true, isAcceptingOrders: true, status: true,
    pureVegRestaurant: true, zoneId: true, area: true, city: true, latitude: true, longitude: true,
    formattedAddress: true, addressLine1: true, addressLine2: true, state: true, pincode: true, landmark: true,
    openingTime: true, closingTime: true, openDays: true,
};

/**
 * Every orderable dish matching `q` (name or Telugu name), from restaurants
 * the customer can order from, and the restaurants still eligible after the
 * restaurant-level filters. A restaurant with no matching available dish can
 * never be in `eligible`, because eligibility is only computed over the
 * restaurants of the matched dishes.
 *
 * Filters: lat, lng, radiusKm (reach), verticalId | vertical, categoryId,
 * isVeg / foodType (dish diet), openOnly (default true), minRating,
 * maxDeliveryTime, pureVeg=true (pure-veg restaurants only), exact=true
 * (dish name equals q, case/space-insensitive, instead of containing it).
 *
 * Returns { requiresLocation } or { foods, eligible: Map(id -> card) }.
 */
async function matchDishRestaurants(query, q, knownReach = null) {
    const reach = knownReach || await reachableRestaurants(query);
    if (reach.requiresLocation) return { requiresLocation: true };
    if (reach.empty) return { foods: [], eligible: new Map() };

    // Each word must appear, so "chicken   biryani" (extra spaces) still reaches
    // the exact-name check below, which compares space-collapsed names. A single
    // contains on the whole phrase dropped such dishes from their own variety.
    const words = normalizeDishName(q).split(' ').filter(Boolean);
    const wordsMatch = (field) => ({ AND: words.map((w) => ({ [field]: { contains: w, mode: 'insensitive' } })) });
    const AND = [
        { restaurantId: { in: reach.ids } },
        { approvalStatus: 'approved' },
        { isAvailable: true },
        { OR: [wordsMatch('name'), wordsMatch('nameTe')] },
    ];
    if (isId(query.categoryId)) AND.push({ categoryId: String(query.categoryId) });
    const typeWhere = foodTypeWhereFromQuery(query);
    if (typeWhere) AND.push(typeWhere);

    let foods = await prisma.foodItem.findMany({
        where: { AND },
        select: { id: true, restaurantId: true, name: true, nameTe: true, image: true, foodType: true },
        orderBy: { createdAt: 'desc' },
        take: MAX_MATCH_ROWS,
    });
    if (String(query.exact) === 'true') {
        const want = normalizeDishName(q);
        foods = foods.filter((f) => normalizeDishName(f.name) === want || normalizeDishName(f.nameTe) === want);
    }
    if (!foods.length) return { foods, eligible: new Map() };

    const where = { id: { in: [...new Set(foods.map((f) => f.restaurantId))] }, status: 'approved' };
    const rating = Number.parseFloat(query.minRating);
    if (Number.isFinite(rating) && rating > 0) where.rating = { gte: Math.min(rating, 5) };
    const minutes = Number.parseInt(query.maxDeliveryTime, 10);
    if (Number.isFinite(minutes) && minutes > 0) where.estimatedDeliveryTimeMinutes = { lte: Math.min(minutes, 1440) };
    if (String(query.pureVeg) === 'true') where.pureVegRestaurant = true;

    const rows = await prisma.foodRestaurant.findMany({ where, select: LISTING_SELECT });
    const openOnly = openOnlyDefaultOn(query);
    const eligible = new Map();
    for (const row of await attachOutletTimingsToRestaurants(rows)) {
        const { nameSlug, ...rest } = row;
        const km = reach.distanceById.get(row.id) ?? null;
        const card = withOpenStatus({ ...toRestaurant(rest), slug: nameSlug || null, distanceKm: km, distanceInKm: km });
        if (openOnly && !card.isOpenNow) continue;
        eligible.set(row.id, card);
    }
    return { foods, eligible };
}

/**
 * Group matched dishes into varieties: one per normalized name, counting the
 * eligible restaurants that serve it. Display name is the most used spelling.
 */
function groupVarieties(foods, eligible, needle, lang) {
    const byKey = new Map();
    for (const f of foods) {
        if (!eligible.has(f.restaurantId)) continue;
        const key = normalizeDishName(f.name);
        if (!key) continue;
        let v = byKey.get(key);
        if (!v) {
            v = { key, spellings: new Map(), nameTe: '', image: '', restaurants: new Set(), itemCount: 0, types: new Set() };
            byKey.set(key, v);
        }
        const spelling = tidyName(f.name);
        v.spellings.set(spelling, (v.spellings.get(spelling) || 0) + 1);
        if (!v.nameTe && f.nameTe) v.nameTe = tidyName(f.nameTe);
        if (!v.image && f.image) v.image = f.image;
        v.restaurants.add(f.restaurantId);
        v.itemCount += 1;
        v.types.add(fromFoodTypeColumn(f.foodType));
    }
    return [...byKey.values()]
        .map((v) => {
            const nameEn = [...v.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0];
            return {
                name: pickText(nameEn, v.nameTe, lang),
                nameEn,
                restaurantCount: v.restaurants.size,
                itemCount: v.itemCount,
                foodType: v.types.size === 1 ? [...v.types][0] : 'Mixed',
                image: v.image,
                relevance: nameRelevance(nameEn, needle),
            };
        })
        .sort((a, b) => b.relevance - a.relevance
            || b.restaurantCount - a.restaurantCount
            || a.nameEn.localeCompare(b.nameEn));
}

/**
 * The typed query for display: first letter of each word in capitals, the rest
 * as typed ("chicken biryani" -> "Chicken Biryani"), spaces collapsed.
 */
export const titleCaseQuery = (value) =>
    String(value ?? '').trim().split(/\s+/).filter(Boolean)
        .map((w) => w.charAt(0).toLocaleUpperCase('en-IN') + w.slice(1))
        .join(' ');

/**
 * GET /food/search/suggest
 *
 * Type-ahead. Nothing until the customer has typed SUGGEST_MIN_CHARS
 * characters; then:
 *  - seeAll: "<Q> — See all restaurants" (q title-cased for display; seeAll.query
 *    stays as typed), with how many restaurants serve a
 *    matching dish right now (null when none do);
 *  - varieties: distinct matching dish names (grouped case/space-insensitively)
 *    with restaurant and item counts, from open restaurants in reach;
 *  - restaurants (by name) and categories, as before;
 *  - dishes: the older per-name list, kept for older app builds.
 * Accepts the same filters as /search/restaurants (see matchDishRestaurants).
 */
export async function suggest(query = {}) {
    const q = term(query.q);
    const lang = languageFromQuery(query);
    const base = {
        query: q, minChars: SUGGEST_MIN_CHARS, seeAll: null, varieties: [], noResults: false,
        dishes: [], restaurants: [], categories: [],
    };
    if (q.length < SUGGEST_MIN_CHARS) return base;

    const reach = await reachableRestaurants(query);
    if (reach.requiresLocation) return { ...base, requiresLocation: true };
    if (reach.empty) return { ...base, noResults: true };

    const match = { contains: q, mode: 'insensitive' };
    const [matched, restaurants, categories] = await Promise.all([
        matchDishRestaurants(query, q, reach),
        prisma.foodRestaurant.findMany({
            where: { id: { in: reach.ids }, status: 'approved', restaurantName: match },
            select: { id: true, restaurantName: true, nameSlug: true, profileImage: true },
            take: 20,
        }),
        prisma.foodCategory.findMany({
            where: {
                restaurantId: null, isActive: true, approvalStatus: 'approved',
                OR: [{ name: match }, { nameTe: match }],
                foodItems: { some: { restaurantId: { in: reach.ids }, approvalStatus: 'approved', isAvailable: true } },
            },
            select: { id: true, name: true, nameTe: true, image: true },
            take: 10,
        }),
    ]);
    const foods = matched.foods || [];
    const eligible = matched.eligible || new Map();
    const needle = normalizeDishName(q);

    // Legacy: one entry per dish name, with how many dishes carry it (any
    // restaurant in reach, open or not) -- unchanged for older app builds.
    const byName = new Map();
    for (const f of foods) {
        const key = String(f.name).trim().toLowerCase();
        const entry = byName.get(key) || { name: pickText(f.name, f.nameTe, lang), nameEn: f.name, image: f.image || '', count: 0 };
        entry.count += 1;
        if (!entry.image && f.image) entry.image = f.image;
        byName.set(key, entry);
    }
    const rank = (name) => (name.toLowerCase().startsWith(needle) ? 0 : 1);
    const dishes = [...byName.values()]
        .sort((a, b) => rank(a.nameEn) - rank(b.nameEn) || b.count - a.count || a.nameEn.localeCompare(b.nameEn))
        .slice(0, 8);

    const varieties = groupVarieties(foods, eligible, needle, lang)
        .slice(0, 10)
        .map(({ relevance, ...v }) => v);
    const serving = new Set(foods.filter((f) => eligible.has(f.restaurantId)).map((f) => f.restaurantId));
    const seeAll = serving.size
        ? { label: `${titleCaseQuery(q)} — See all restaurants`, query: q, restaurantCount: serving.size }
        : null;

    const out = {
        ...base,
        seeAll,
        varieties,
        dishes,
        restaurants: restaurants
            .sort((a, b) => rank(a.restaurantName) - rank(b.restaurantName)
                || (reach.distanceById.get(a.id) ?? Infinity) - (reach.distanceById.get(b.id) ?? Infinity))
            .slice(0, 5)
            .map((r) => ({
                id: r.id, name: r.restaurantName, slug: r.nameSlug || null, image: r.profileImage || null,
                distanceKm: reach.distanceById.get(r.id) ?? null,
            })),
        categories: categories.slice(0, 5).map((c) => ({
            id: c.id, name: pickText(c.name, c.nameTe, lang), nameEn: c.name, image: c.image || '',
        })),
    };
    out.noResults = !out.seeAll && !out.varieties.length && !out.restaurants.length && !out.categories.length;
    return out;
}

const RESTAURANT_SORTS = {
    rating: (a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0) || (Number(b.totalRatings) || 0) - (Number(a.totalRatings) || 0),
    distance: (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
    deliveryTime: (a, b) => (a.estimatedDeliveryTimeMinutes ?? Infinity) - (b.estimatedDeliveryTimeMinutes ?? Infinity),
};

/**
 * GET /food/search/restaurants
 *
 * "See all restaurants" for a dish search: only restaurants that currently
 * serve at least one available dish matching q, in reach of lat/lng.
 * q (>= 2 chars, required -- an empty q never lists anything), lat, lng,
 * radiusKm, exact=true, openOnly (default true), isVeg, foodType, categoryId,
 * verticalId | vertical, minRating, maxDeliveryTime, pureVeg=true,
 * sortBy = relevance (default) | rating | distance | deliveryTime, lang, page, limit (<= 50).
 *
 * Each card is the unified-search restaurant card plus matchedDishCount and
 * up to 3 matchedDishes at the customer's price.
 */
export async function searchDishRestaurants(query = {}) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 50);
    const q = term(query.q);
    const lang = languageFromQuery(query);
    const empty = (extra = {}) => ({ query: q, restaurants: [], total: 0, page, limit, ...extra });
    if (q.length < DISH_RESTAURANTS_MIN_CHARS) return empty({ minChars: DISH_RESTAURANTS_MIN_CHARS });

    const reach = await reachableRestaurants(query);
    if (reach.requiresLocation) return empty({ requiresLocation: true });
    if (reach.empty) return empty();
    // Timed out-of-stock that has run out comes back before matching.
    await restoreExpiredFoodAvailability({ restaurantId: { in: reach.ids } });

    const { foods = [], eligible = new Map() } = await matchDishRestaurants(query, q, reach);
    const needle = normalizeDishName(q);

    // Dishes per eligible restaurant, best match first.
    const dishesBy = new Map();
    for (const f of foods) {
        if (!eligible.has(f.restaurantId)) continue;
        const list = dishesBy.get(f.restaurantId) || [];
        list.push({ ...f, relevance: nameRelevance(f.name, needle) });
        dishesBy.set(f.restaurantId, list);
    }
    const ranked = [...dishesBy.entries()].map(([id, list]) => {
        list.sort((a, b) => b.relevance - a.relevance);
        return { card: eligible.get(id), list, relevance: list[0].relevance };
    });
    const within = RESTAURANT_SORTS[String(query.sortBy || '')]
        ? (a, b) => RESTAURANT_SORTS[String(query.sortBy)](a.card, b.card)
        : (a, b) => b.relevance - a.relevance
            || b.list.length - a.list.length
            || (a.card.distanceKm ?? Infinity) - (b.card.distanceKm ?? Infinity);
    ranked.sort((a, b) => openFirst(a.card, b.card) || within(a, b));

    const total = ranked.length;
    const pageRows = ranked.slice((page - 1) * limit, page * limit);

    // Prices only for the dishes shown: the customer's price after app price rules.
    const shownIds = pageRows.flatMap((r) => r.list.slice(0, 3).map((f) => f.id));
    const full = shownIds.length
        ? await applyAppPricing(await prisma.foodItem.findMany({
            where: { id: { in: shownIds } },
            include: { variants: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
        }))
        : [];
    const fullById = new Map(full.map((f) => [f.id, f]));

    const restaurants = pageRows.map(({ card, list }) => {
        const matchedDishes = list.slice(0, 3).map((f) => {
            const food = fullById.get(f.id) || f;
            return {
                id: f.id,
                name: pickText(f.name, f.nameTe, lang),
                nameEn: f.name,
                price: Number(getFoodDisplayPrice(food)) || 0,
                otherPrice: Number(getFoodDisplayOtherPrice(food)) || 0,
                hasVariants: Array.isArray(food.variants) && food.variants.length > 0,
                image: f.image || '',
                foodType: fromFoodTypeColumn(f.foodType),
                isVeg: fromFoodTypeColumn(f.foodType) === 'Veg',
            };
        });
        const first = matchedDishes[0];
        return {
            ...card,
            // Same keys unified search uses for a dish match, so existing cards render it.
            matchType: 'food',
            matchedDish: first?.nameEn || null,
            matchedDishId: first?.id || null,
            matchedDishImage: first?.image || null,
            matchedDishCount: list.length,
            matchedDishes,
        };
    });
    return { query: q, restaurants, total, page, limit };
}
