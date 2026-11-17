import { sendResponse } from '../../../../utils/response.js';
import { searchDishes, suggest } from '../services/dishSearch.service.js';

// The whole query is handed on (not copied field by field) so a filter added
// to the service cannot be silently dropped here.
export const searchDishesController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Dishes fetched successfully', await searchDishes(req.query || {}));
    } catch (error) {
        return next(error);
    }
};

export const suggestController = async (req, res, next) => {
    try {
        return sendResponse(res, 200, 'Suggestions fetched successfully', await suggest(req.query || {}));
    } catch (error) {
        return next(error);
    }
};
