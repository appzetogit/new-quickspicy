import { sendResponse } from '../../../../utils/response.js';
import { getOrderAgain } from '../services/orderAgain.service.js';
import { getReorderStores } from '../services/reorder.service.js';
import { shareCart, previewSharedCart, importSharedCart } from '../services/sharedCart.service.js';

const run = (status, message, fn) => async (req, res, next) => {
    try {
        return sendResponse(res, status, message, await fn(req));
    } catch (error) {
        return next(error);
    }
};

export const orderAgainController = run(200, 'Order again fetched', (req) => getOrderAgain(req.user?.userId, req.query || {}));
export const reorderController = run(200, 'Reorder fetched', (req) => getReorderStores(req.user?.userId, req.query || {}));
export const shareCartController = run(201, 'Cart shared', (req) => shareCart(req.user?.userId, req.body?.restaurantId || req.query?.restaurantId || null));
export const previewSharedCartController = run(200, 'Shared cart fetched', (req) => previewSharedCart(req.params.token));
export const importSharedCartController = run(200, 'Shared cart added to your cart',
    (req) => importSharedCart(req.user?.userId, req.params.token));
