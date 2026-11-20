import { sendResponse } from '../../../../utils/response.js';
import {
    syncUserCart,
    listUserCarts,
    getUserCart,
    getLatestUserCart,
    replaceUserCart,
    deleteUserCart,
    clearUserCarts,
    addUserCartItem,
    updateUserCartItem,
    removeUserCartItem,
} from '../services/userCart.service.js';

const run = (status, message, fn) => async (req, res, next) => {
    try {
        return sendResponse(res, status, message, await fn(req));
    } catch (error) {
        return next(error);
    }
};

/**
 * PUT /food/user/cart: the original single-cart sync, kept for app builds
 * that predate multiple carts. Items are saved to the cart of their own
 * restaurant; an empty list deletes `restaurantId`'s cart when given, else
 * the most recently changed cart.
 */
export const syncUserCartController = async (req, res, next) => {
    try {
        const userId = req.user?.userId;
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        const pricing = req.body?.pricing || null;
        const firstItem = items[0] || {};

        const payload = items.map((item) => ({
            ...item,
            restaurantId: item?.restaurantId || firstItem?.restaurantId || req.body?.restaurantId || '',
            restaurantName: item?.restaurant || item?.restaurantName || firstItem?.restaurant || req.body?.restaurantName || '',
        }));

        const result = await syncUserCart(userId, payload, pricing, {
            // Only an empty list needs the name: items carry their own restaurant.
            restaurantId: payload.length ? null : req.body?.restaurantId || null,
            restaurantName: req.body?.restaurantName || '',
        });
        return sendResponse(res, 200, 'Cart synced successfully', {
            synced: Boolean(result),
            itemCount: result?.itemCount || 0,
            restaurantId: result?.restaurantId || null,
        });
    } catch (error) {
        next(error);
    }
};

/** GET /food/user/cart[?restaurantId=]: one cart for single-cart clients (latest when no id). */
export const getLatestUserCartController = run(200, 'Cart fetched',
    (req) => getLatestUserCart(req.user?.userId, req.query?.restaurantId || null));

/** GET /food/user/carts */
export const listUserCartsController = run(200, 'Carts fetched', (req) => listUserCarts(req.user?.userId));

/** DELETE /food/user/carts */
export const clearUserCartsController = run(200, 'All carts cleared', (req) => clearUserCarts(req.user?.userId));

/** GET /food/user/carts/:restaurantId */
export const getUserCartController = run(200, 'Cart fetched',
    (req) => getUserCart(req.user?.userId, req.params.restaurantId));

/** PUT /food/user/carts/:restaurantId */
export const replaceUserCartController = run(200, 'Cart saved',
    (req) => replaceUserCart(
        req.user?.userId,
        req.params.restaurantId,
        Array.isArray(req.body?.items) ? req.body.items : [],
        req.body?.pricing || null,
    ));

/** DELETE /food/user/carts/:restaurantId */
export const deleteUserCartController = run(200, 'Cart removed',
    (req) => deleteUserCart(req.user?.userId, req.params.restaurantId));

/** POST /food/user/carts/:restaurantId/items */
export const addUserCartItemController = run(200, 'Added to cart',
    (req) => addUserCartItem(req.user?.userId, req.params.restaurantId, req.body || {}));

/** PATCH /food/user/carts/:restaurantId/items/:itemId */
export const updateUserCartItemController = run(200, 'Cart updated',
    (req) => updateUserCartItem(req.user?.userId, req.params.restaurantId, req.params.itemId, req.body || {}));

/** DELETE /food/user/carts/:restaurantId/items/:itemId[?variantId=] */
export const removeUserCartItemController = run(200, 'Removed from cart',
    (req) => removeUserCartItem(
        req.user?.userId,
        req.params.restaurantId,
        req.params.itemId,
        String(req.query?.variantId || ''),
    ));
