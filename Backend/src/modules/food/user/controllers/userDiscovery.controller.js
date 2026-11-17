import { sendResponse } from '../../../../utils/response.js';
import { getOrderAgain } from '../services/orderAgain.service.js';
import { shareCart, previewSharedCart, importSharedCart } from '../services/sharedCart.service.js';

const run = (status, message, fn) => async (req, res, next) => {
    try {
        return sendResponse(res, status, message, await fn(req));
    } catch (error) {
        return next(error);
    }
};

export const orderAgainController = run(200, 'Order again fetched', (req) => getOrderAgain(req.user?.userId, req.query || {}));
export const shareCartController = run(201, 'Cart shared', (req) => shareCart(req.user?.userId));
export const previewSharedCartController = run(200, 'Shared cart fetched', (req) => previewSharedCart(req.params.token));
export const importSharedCartController = run(200, 'Shared cart added to your cart',
    (req) => importSharedCart(req.user?.userId, req.params.token));
