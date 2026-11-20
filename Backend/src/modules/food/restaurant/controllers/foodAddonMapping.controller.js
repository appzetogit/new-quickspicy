import { sendResponse, sendError } from '../../../../utils/response.js';
import { getFoodAddonMapping, setFoodAddons } from '../../shared/foodAddonMapping.service.js';

/** GET /food/restaurant/foods/:id/addons — own dish only. */
export const getRestaurantFoodAddonsController = async (req, res, next) => {
    try {
        const data = await getFoodAddonMapping(req.params.id, { restaurantId: req.user?.userId });
        if (!data) return sendError(res, 404, 'Food not found');
        return sendResponse(res, 200, 'Food add-ons fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

/** PUT /food/restaurant/foods/:id/addons { addonIds } — own dish and own add-ons only. */
export const setRestaurantFoodAddonsController = async (req, res, next) => {
    try {
        const data = await setFoodAddons(req.params.id, req.body?.addonIds, { restaurantId: req.user?.userId });
        if (!data) return sendError(res, 404, 'Food not found');
        return sendResponse(res, 200, 'Food add-ons saved successfully', data);
    } catch (error) {
        next(error);
    }
};
