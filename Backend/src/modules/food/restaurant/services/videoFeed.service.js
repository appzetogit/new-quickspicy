import { prisma } from '../../../../config/prisma.js';
import { isId } from '../../../../utils/helpers.js';
import { restaurantsInReach } from '../../shared/deliveryRadius.js';
import { verticalFilterFromQuery } from '../../shared/verticals.js';
import { languageFromQuery, pickText } from '../../shared/language.js';
import { applyAppPricing } from '../../pricing/priceRules.service.js';
import { getFoodDisplayPrice } from '../../admin/services/foodVariant.service.js';
import { restaurantCards } from '../../search/services/dishSearch.service.js';
import { readVideos } from './restaurantBanner.service.js';

/**
 * The video feed: short videos of dishes (FoodItem.videoUrl) and storefront
 * videos restaurants upload, from restaurants that deliver to the customer.
 *
 * Personalised when the customer is signed in: restaurants they have ordered
 * from come first. Then open restaurants before closed ones, then nearest.
 * Media urls are signed by the response middleware like everywhere else.
 */

export async function getVideoFeed(query = {}, userId = null) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 10, 1), 30);
    const lang = languageFromQuery(query);
    const empty = (extra = {}) => ({ items: [], total: 0, page, limit, ...extra });

    const reach = await restaurantsInReach({ lat: query.lat, lng: query.lng, radiusKm: query.radiusKm });
    if (reach.requiresLocation) return empty({ requiresLocation: true });
    let ids = [...reach.distanceById.keys()];
    if (!ids.length) return empty();

    const pick = await verticalFilterFromQuery(query);
    if (pick.none) return empty();

    const restaurants = await prisma.foodRestaurant.findMany({
        where: { id: { in: ids }, status: 'approved', ...(pick.filter || {}) },
        select: { id: true, videos: true },
    });
    ids = restaurants.map((r) => r.id);
    if (!ids.length) return empty();

    const foods = await prisma.foodItem.findMany({
        where: { restaurantId: { in: ids }, approvalStatus: 'approved', isAvailable: true, videoUrl: { not: '' } },
        include: { variants: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
        orderBy: { updatedAt: 'desc' },
        take: 500,
    });
    const restaurantVideos = restaurants.flatMap((r) =>
        readVideos(r.videos).map((video, i) => ({ restaurantId: r.id, video, i })));
    if (!foods.length && !restaurantVideos.length) return empty();

    const cards = await restaurantCards(
        [...foods.map((f) => f.restaurantId), ...restaurantVideos.map((v) => v.restaurantId)],
        reach.distanceById,
    );

    let orderedFrom = new Set();
    if (isId(userId)) {
        const past = await prisma.foodOrder.groupBy({
            by: ['restaurantId'],
            where: { userId: String(userId), orderStatus: 'delivered', restaurantId: { in: ids } },
        });
        orderedFrom = new Set(past.map((p) => p.restaurantId));
    }

    const priced = await applyAppPricing(foods);
    const items = [
        ...priced.map((food) => ({
            type: 'dish',
            id: `dish:${food.id}`,
            dishId: food.id,
            title: pickText(food.name, food.nameTe, lang),
            titleEn: food.name,
            videoUrl: food.videoUrl,
            poster: food.image || '',
            price: Number(getFoodDisplayPrice(food)) || 0,
            isVeg: food.foodType === 'Veg',
            restaurant: cards.get(food.restaurantId),
        })),
        ...restaurantVideos.map(({ restaurantId, video, i }) => ({
            type: 'restaurant',
            id: `restaurant:${restaurantId}:${i}`,
            dishId: null,
            title: cards.get(restaurantId)?.name || '',
            titleEn: cards.get(restaurantId)?.name || '',
            videoUrl: video.url,
            mimeType: video.mimeType || '',
            poster: video.poster || '',
            restaurant: cards.get(restaurantId),
        })),
    ]
        .filter((item) => item.restaurant)
        .map((item) => ({ ...item, forYou: orderedFrom.has(item.restaurant.id) }));

    items.sort((a, b) =>
        Number(b.forYou) - Number(a.forYou)
        || Number(b.restaurant.isOpenNow) - Number(a.restaurant.isOpenNow)
        || (a.restaurant.distanceKm ?? Infinity) - (b.restaurant.distanceKm ?? Infinity));

    return { items: items.slice((page - 1) * limit, page * limit), total: items.length, page, limit };
}
