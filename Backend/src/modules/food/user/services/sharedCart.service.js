import crypto from 'node:crypto';
import { prisma } from '../../../../config/prisma.js';
import { isId } from '../../../../utils/helpers.js';
import { ValidationError, NotFoundError } from '../../../../core/auth/errors.js';
import { applyAppPricing } from '../../pricing/priceRules.service.js';
import { getFoodDisplayPrice, getFoodDisplayOtherPrice } from '../../admin/services/foodVariant.service.js';
import { restaurantCards } from '../../search/services/dishSearch.service.js';
import { syncUserCart } from './userCart.service.js';

/**
 * Share cart: send your cart to someone as a link; they open it and copy it
 * into their own cart.
 *
 * The link stores what was in the cart (dish, variant, quantity), never the
 * prices. Prices and availability are read when the link is opened, so a
 * shared cart cannot carry an old price, and a dish that has since gone out of
 * stock shows as unavailable instead of failing at checkout.
 */

const LINK_DAYS = 7;
const MAX_SHARES_PER_DAY = 50;

const newToken = () => crypto.randomBytes(12).toString('base64url'); // 16 url-safe chars

const shareUrl = (token) =>
    `${String(process.env.FRONTEND_URL || 'https://new.quickspicy.in').replace(/\/+$/, '')}/food/user/cart/shared/${token}`;

export async function shareCart(userId) {
    if (!isId(userId)) throw new ValidationError('Invalid user');
    const cart = await prisma.foodUserCart.findUnique({ where: { userId: String(userId) } });
    const lines = Array.isArray(cart?.items) ? cart.items : [];
    if (!cart || !lines.length || !isId(cart.restaurantId)) {
        throw new ValidationError('Your cart is empty. Add something before sharing it.');
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await prisma.foodSharedCart.count({ where: { sharedByUserId: String(userId), createdAt: { gte: since } } });
    if (recent >= MAX_SHARES_PER_DAY) throw new ValidationError('You have shared a lot of carts today. Try again tomorrow.');

    const items = lines
        .filter((line) => isId(line?.itemId))
        .map((line) => ({
            itemId: String(line.itemId),
            name: String(line.name || ''),
            quantity: Math.max(1, Math.min(50, Math.floor(Number(line.quantity) || 1))),
            variantId: String(line.variantId || ''),
            variantName: String(line.variantName || ''),
        }));
    if (!items.length) throw new ValidationError('Your cart is empty. Add something before sharing it.');

    const row = await prisma.foodSharedCart.create({
        data: {
            token: newToken(),
            sharedByUserId: String(userId),
            restaurantId: cart.restaurantId,
            restaurantName: cart.restaurantName || '',
            items,
            itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
            expiresAt: new Date(Date.now() + LINK_DAYS * 24 * 60 * 60 * 1000),
        },
    });
    return { token: row.token, shareUrl: shareUrl(row.token), expiresAt: row.expiresAt, itemCount: row.itemCount };
}

const loadShared = async (token) => {
    const value = String(token ?? '').trim();
    if (!/^[A-Za-z0-9_-]{8,24}$/.test(value)) throw new NotFoundError('Shared cart not found');
    const row = await prisma.foodSharedCart.findUnique({ where: { token: value } });
    if (!row) throw new NotFoundError('Shared cart not found');
    if (row.expiresAt < new Date()) throw new NotFoundError('This shared cart has expired. Ask for a new link.');
    return row;
};

/** The shared cart as it would be today: current prices, and what is still available. */
export async function previewSharedCart(token) {
    const row = await loadShared(token);
    const lines = Array.isArray(row.items) ? row.items : [];

    const [foods, cards, sharer] = await Promise.all([
        prisma.foodItem.findMany({
            where: {
                id: { in: lines.map((l) => l.itemId).filter(isId) },
                restaurantId: row.restaurantId,
                approvalStatus: 'approved',
                isAvailable: true,
            },
            include: { variants: true },
        }),
        restaurantCards([row.restaurantId], null),
        prisma.foodUser.findUnique({ where: { id: row.sharedByUserId }, select: { name: true } }),
    ]);
    const restaurant = cards.get(row.restaurantId) || null;
    const byId = new Map((await applyAppPricing(foods)).map((f) => [f.id, f]));

    const items = lines.map((line) => {
        const food = restaurant ? byId.get(line.itemId) : null;
        const variant = food && line.variantId
            ? (food.variants || []).find((v) => v.id === line.variantId) || null
            : null;
        const available = Boolean(food) && (!line.variantId || Boolean(variant));
        const price = !available ? 0 : variant ? Number(variant.price) || 0 : Number(getFoodDisplayPrice(food)) || 0;
        return {
            itemId: line.itemId,
            name: food?.name || line.name,
            quantity: line.quantity,
            variantId: line.variantId || '',
            variantName: variant?.name || line.variantName || '',
            price,
            otherPrice: available && !variant ? Number(getFoodDisplayOtherPrice(food)) || 0 : 0,
            image: food?.image || '',
            foodType: food?.foodType || '',
            isVeg: food?.foodType === 'Veg',
            available,
        };
    });
    const availableItems = items.filter((i) => i.available);

    return {
        token: row.token,
        // First name only: the receiver needs to know who sent it, not more.
        sharedBy: String(sharer?.name || '').trim().split(/\s+/)[0] || null,
        restaurant,
        restaurantAvailable: Boolean(restaurant),
        items,
        availableCount: availableItems.length,
        unavailableCount: items.length - availableItems.length,
        subtotal: Math.round(availableItems.reduce((sum, i) => sum + i.price * i.quantity, 0) * 100) / 100,
        expiresAt: row.expiresAt,
    };
}

/**
 * Copy a shared cart into the signed-in customer's cart, replacing what is
 * there (the app asks first). Only available dishes are copied; the rest are
 * listed back so the app can say what was left out.
 */
export async function importSharedCart(userId, token) {
    if (!isId(userId)) throw new ValidationError('Invalid user');
    const preview = await previewSharedCart(token);
    if (!preview.restaurantAvailable) throw new ValidationError('This restaurant is not taking orders through the app any more.');
    const usable = preview.items.filter((i) => i.available);
    if (!usable.length) throw new ValidationError('None of the dishes in this cart are available right now.');

    const cart = await syncUserCart(userId, usable.map((i) => ({
        itemId: i.itemId,
        restaurantId: preview.restaurant.id,
        restaurantName: preview.restaurant.name,
        name: i.name,
        price: i.price,
        otherPrice: i.otherPrice,
        quantity: i.quantity,
        variantId: i.variantId || undefined,
        variantName: i.variantName || undefined,
        variantPrice: i.price,
        image: i.image,
        foodType: i.foodType,
        isVeg: i.isVeg,
    })));
    await prisma.foodSharedCart.update({ where: { token: preview.token }, data: { importCount: { increment: 1 } } });

    return {
        cart,
        added: usable.length,
        skipped: preview.items.filter((i) => !i.available).map((i) => i.name),
    };
}
