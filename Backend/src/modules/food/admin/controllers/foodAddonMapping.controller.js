import { sendResponse, sendError } from '../../../../utils/response.js';
import { getFoodAddonMapping, setFoodAddons } from '../../shared/foodAddonMapping.service.js';

/** GET /food/admin/foods/:id/addons — the dish's restaurant's approved add-ons, with `selected`. */
export const getAdminFoodAddonsController = async (req, res, next) => {
    try {
        const data = await getFoodAddonMapping(req.params.id);
        if (!data) return sendError(res, 404, 'Food not found');
        return sendResponse(res, 200, 'Food add-ons fetched successfully', data);
    } catch (error) {
        next(error);
    }
};

/** PUT /food/admin/foods/:id/addons { addonIds } */
export const setAdminFoodAddonsController = async (req, res, next) => {
    try {
        const data = await setFoodAddons(req.params.id, req.body?.addonIds);
        if (!data) return sendError(res, 404, 'Food not found');
        return sendResponse(res, 200, 'Food add-ons saved successfully', data);
    } catch (error) {
        next(error);
    }
};
