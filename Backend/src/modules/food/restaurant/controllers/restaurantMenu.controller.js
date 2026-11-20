import { sendResponse } from '../../../../utils/response.js';
import {
    getRestaurantMenu,
    updateRestaurantMenu,
    getPublicApprovedRestaurantMenu
} from '../services/restaurantMenu.service.js';
import { languageFromQuery } from '../../shared/language.js';

export const getMenuController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const menu = await getRestaurantMenu(restaurantId);
        // Expired FSSAI licence (when the admin block is on): the app disables ordering with this reason.
        const { getFssaiOrderingBlock } = await import('../services/fssaiExpiry.service.js');
        const fssai = await getFssaiOrderingBlock(menu.restaurantId || menu.restaurant?.id || menu.restaurant?._id || req.params.id).catch(() => null);
        if (fssai?.blocked && menu && typeof menu === 'object') {
            menu.orderingBlocked = true;
            menu.orderingBlockedReason = fssai.reason;
        }
        return sendResponse(res, 200, 'Menu fetched successfully', { menu });
    } catch (error) {
        next(error);
    }
};

export const updateMenuController = async (req, res, next) => {
    try {
        const restaurantId = req.user?.userId;
        const menu = await updateRestaurantMenu(restaurantId, req.body || {});
        return sendResponse(res, 200, 'Menu updated successfully', { menu });
    } catch (error) {
        next(error);
    }
};

export const getPublicRestaurantMenuController = async (req, res, next) => {
    try {
        const menu = await getPublicApprovedRestaurantMenu(req.params.id, {
            lang: languageFromQuery(req.query),
            foodType: req.query?.foodType,
            isVeg: req.query?.isVeg,
        });
        if (!menu) {
            return res.status(404).json({ success: false, message: 'Restaurant not found' });
        }
        return sendResponse(res, 200, 'Menu fetched successfully', { menu });
    } catch (error) {
        next(error);
    }
};

