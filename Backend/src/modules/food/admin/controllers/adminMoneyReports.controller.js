import { ForbiddenError } from '../../../../core/auth/errors.js';
import { getEodReport } from '../services/reportEod.service.js';
import { getCustomerWalletReport } from '../services/reportCustomerWallet.service.js';
import { getOnlinePaymentsReport } from '../services/reportOnlinePayments.service.js';

/**
 * EOD cumulative, customer wallet utilisation and online payments reports.
 * Mounted under /reports, so the report_management guard applies.
 */
const handle = (message, run) => async (req, res, next) => {
    try {
        const data = await run(req);
        return res.status(200).json({ success: true, message, data });
    } catch (error) {
        return next(error);
    }
};

export const eodReport = handle('EOD report fetched', (req) => getEodReport(req.query || {}));

// Customers belong to no city, so a city-limited sub-admin has no slice of
// them -- the same rule as the Customers screens.
export const customerWalletReport = handle('Customer wallet report fetched', (req) => {
    if (req.adminScope) throw new ForbiddenError('Customer wallets are managed by the super admin');
    return getCustomerWalletReport(req.query || {});
});

export const onlinePaymentsReport = handle('Online payments fetched', (req) => getOnlinePaymentsReport(req.query || {}));
