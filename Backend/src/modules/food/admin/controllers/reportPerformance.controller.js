import { deliveryPerformanceReport } from '../services/reportDelivery.service.js';
import { promoUsageReport } from '../services/reportPromo.service.js';

/** Delivery performance and promo usage reports: the usual { success, message, data } envelope. */
const handle = (message, run) => async (req, res, next) => {
    try {
        return res.status(200).json({ success: true, message, data: await run(req) });
    } catch (error) {
        return next(error);
    }
};

export const getDeliveryPerformanceReport = handle('Report fetched', (req) => deliveryPerformanceReport(req.query || {}));
export const getPromoUsageReport = handle('Report fetched', (req) => promoUsageReport(req.query || {}));
