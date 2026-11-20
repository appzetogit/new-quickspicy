import { getPopularItemsReport } from '../services/reportPopular.service.js';
import { getCancellationReport } from '../services/reportCancellation.service.js';
import { getInventoryReport } from '../services/reportInventory.service.js';

/** Popular items, cancellations and stock reports: { success, message, data }. */
const handle = (run) => async (req, res, next) => {
    try {
        const data = await run(req.query || {});
        return res.status(200).json({ success: true, message: 'Report fetched', data });
    } catch (error) {
        return next(error);
    }
};

export const popularItemsReport = handle(getPopularItemsReport);
export const cancellationReport = handle(getCancellationReport);
export const inventoryReport = handle(getInventoryReport);
