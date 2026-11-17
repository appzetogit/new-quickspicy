import { prisma } from '../../../../config/prisma.js';
import { isId } from '../../../../utils/helpers.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { restaurantsInReach } from '../../shared/deliveryRadius.js';
import { languageFromQuery, pickText } from '../../shared/language.js';
import { applyAppPricing } from '../../pricing/priceRules.service.js';
import { getFoodDisplayPrice, getFoodDisplayOtherPrice } from '../../admin/services/foodVariant.service.js';
import { restaurantCards } from '../../search/services/dishSearch.service.js';

/**
 * "Order again": dishes and restaurants from the customer's delivered orders
 * that can still be ordered.
 *
 * Built from the dishes as they are today, not as they were on the receipt:
 * the current price (with admin price rules), and only dishes still approved
 * and available from approved restaurants. With a location, only restaurants
 * that deliver there; without one, every restaurant, with distance unknown.
 */

const HISTORY_ORDERS = 50;

export async function getOrderAgain(userId, query = {}) {
    if (!isId(userId)) throw new ValidationError('Invalid user');
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 50);
    const lang = languageFromQuery(query);

    const orders = await prisma.foodOrder.findMany({
        where: { userId: String(userId), orderStatus: 'delivered' },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_ORDERS,
        select: {
            id: true, restaurantId: true, createdAt: true,
            items: { select: { itemId: true, quantity: true } },
        },
    });
    if (!orders.length) return { items: [], restaurants: [] };

    // Per dish: how many orders it was in, and when last.
    const byItem = new Map();
    const byRestaurant = new Map();
    for (const order of orders) {
        const r = byRestaurant.get(order.restaurantId) || { orders: 0, lastOrderedAt: order.createdAt };
        r.orders += 1;
        byRestaurant.set(order.restaurantId, r);
        const seenInThisOrder = new Set();
        for (const line of order.items) {
            const itemId = String(line.itemId || '');
            if (!isId(itemId) || seenInThisOrder.has(itemId)) continue;
            seenInThisOrder.add(itemId);
            const entry = byItem.get(itemId) || { timesOrdered: 0, lastOrderedAt: order.createdAt };
            entry.timesOrdered += 1;
            byItem.set(itemId, entry);
        }
    }

    let reachable = null;
    let distanceById = null;
    const reach = await restaurantsInReach({ lat: query.lat, lng: query.lng, radiusKm: query.radiusKm });
    if (!reach.requiresLocation) {
        distanceById = reach.distanceById;
        reachable = new Set(reach.distanceById.keys());
    }

    const restaurantIds = [...byRestaurant.keys()].filter((id) => isId(id) && (!reachable || reachable.has(id)));
    const cards = await restaurantCards(restaurantIds, distanceById);

    const foods = await prisma.foodItem.findMany({
        where: {
            id: { in: [...byItem.keys()] },
            restaurantId: { in: [...cards.keys()] },
            approvalStatus: 'approved',
            isAvailable: true,
        },
        include: { variants: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
    });
    const priced = await applyAppPricing(foods);

    const items = priced
        .map((food) => {
            const history = byItem.get(food.id);
            return {
                id: food.id,
                name: pickText(food.name, food.nameTe, lang),
                nameEn: food.name,
                price: Number(getFoodDisplayPrice(food)) || 0,
                otherPrice: Number(getFoodDisplayOtherPrice(food)) || 0,
                hasVariants: Array.isArray(food.variants) && food.variants.length > 0,
                image: food.image || '',
                foodType: food.foodType || 'Non-Veg',
                isVeg: food.foodType === 'Veg',
                timesOrdered: history.timesOrdered,
                lastOrderedAt: history.lastOrderedAt,
                restaurant: cards.get(food.restaurantId),
            };
        })
        .sort((a, b) =>
            Number(b.restaurant.isOpenNow) - Number(a.restaurant.isOpenNow)
            || b.timesOrdered - a.timesOrdered
            || new Date(b.lastOrderedAt) - new Date(a.lastOrderedAt))
        .slice(0, limit);

    const restaurants = [...cards.values()]
        .map((card) => ({ ...card, ordersCount: byRestaurant.get(card.id).orders, lastOrderedAt: byRestaurant.get(card.id).lastOrderedAt }))
        .sort((a, b) => Number(b.isOpenNow) - Number(a.isOpenNow) || b.ordersCount - a.ordersCount
            || new Date(b.lastOrderedAt) - new Date(a.lastOrderedAt))
        .slice(0, 10);

    return { items, restaurants };
}
