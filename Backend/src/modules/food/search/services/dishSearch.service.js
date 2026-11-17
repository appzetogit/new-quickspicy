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
 * isVeg=true, minPrice, maxPrice, minRating, openOnly=true,
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
    if (query.isVeg === 'true') AND.push({ foodType: 'Veg' });

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

/**
 * GET /food/search/suggest
 *
 * Type-ahead. Nothing until the customer has typed SUGGEST_MIN_CHARS
 * characters; then dish names, restaurants and categories they can order from.
 */
export async function suggest(query = {}) {
    const q = term(query.q);
    const lang = languageFromQuery(query);
    const base = { query: q, minChars: SUGGEST_MIN_CHARS, dishes: [], restaurants: [], categories: [] };
    if (q.length < SUGGEST_MIN_CHARS) return base;

    const reach = await reachableRestaurants(query);
    if (reach.requiresLocation) return { ...base, requiresLocation: true };
    if (reach.empty) return base;

    const match = { contains: q, mode: 'insensitive' };
    const [foods, restaurants, categories] = await Promise.all([
        prisma.foodItem.findMany({
            where: {
                restaurantId: { in: reach.ids }, approvalStatus: 'approved', isAvailable: true,
                OR: [{ name: match }, { nameTe: match }],
            },
            select: { name: true, nameTe: true, image: true },
            take: 200,
        }),
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

    // One entry per dish name, with how many restaurants serve it.
    const needle = q.toLowerCase();
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

    return {
        ...base,
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
}
