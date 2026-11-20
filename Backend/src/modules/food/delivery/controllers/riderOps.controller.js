import { sendResponse } from '../../../../utils/response.js';
import { reportRunningLate } from '../../orders/services/orderDelay.service.js';
import { recordChangeOwed, getChangeOwedForRider } from '../../orders/services/changeCredit.service.js';
import { confirmCompanyUpiPayment } from '../../orders/services/companyCollection.service.js';

/**
 * Rider actions on a live order: running late, change owed to the customer,
 * and confirming a payment made to the company UPI QR.
 * Mounted under /food/delivery/orders/:orderId (DELIVERY_PARTNER only).
 */

export async function runningLateController(req, res, next) {
    try {
        const data = await reportRunningLate({
            orderId: req.params.orderId,
            reason: req.body?.reason,
            extraMinutes: Number(req.body?.extraMinutes),
            note: req.body?.note,
            by: { role: 'DELIVERY_PARTNER', id: req.user?.userId },
        });
        return sendResponse(res, 200, 'Customer told you are running late', data);
    } catch (err) {
        return next(err);
    }
}

export async function recordChangeOwedController(req, res, next) {
    try {
        const data = await recordChangeOwed(req.params.orderId, req.user?.userId, {
            amount: req.body?.amount,
            cashCollected: req.body?.cashCollected,
            note: req.body?.note,
        });
        return sendResponse(res, 200, 'Change recorded; it goes to the customer wallet once verified', data);
    } catch (err) {
        return next(err);
    }
}

export async function getChangeOwedController(req, res, next) {
    try {
        const data = await getChangeOwedForRider(req.params.orderId, req.user?.userId);
        return sendResponse(res, 200, 'Change request', { changeCredit: data });
    } catch (err) {
        return next(err);
    }
}

export async function confirmUpiPaymentController(req, res, next) {
    try {
        const data = await confirmCompanyUpiPayment(req.params.orderId, req.user?.userId, { utr: req.body?.utr });
        return sendResponse(res, 200, 'UPI payment noted; finance will reconcile it', data);
    } catch (err) {
        return next(err);
    }
}
