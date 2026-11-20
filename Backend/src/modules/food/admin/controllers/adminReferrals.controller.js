import { sendResponse, sendError } from '../../../../utils/response.js';
import * as referrals from '../services/adminReferrals.service.js';

/** Customers have no city, so a city-limited sub-admin gets no customer referrals (same rule as /customers). */
const customerTabBlocked = (req) => {
    const type = String(req.query?.type || req.query?.role || 'user').toLowerCase();
    return Boolean(req.adminScope) && !['delivery', 'rider', 'riders', 'delivery_partner'].includes(type);
};

export async function listReferrers(req, res, next) {
    try {
        if (customerTabBlocked(req)) return sendError(res, 403, 'Customer referrals are managed by the super admin');
        if (String(req.query?.format || '').toLowerCase() === 'csv') {
            const { csv, type } = await referrals.exportReferrersCsv(req.query || {});
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="referrers-${type}.csv"`);
            return res.status(200).send(csv);
        }
        const data = await referrals.listReferrers(req.query || {});
        return sendResponse(res, 200, 'Referrers fetched', data);
    } catch (e) { next(e); }
}

export async function listReferees(req, res, next) {
    try {
        if (customerTabBlocked(req)) return sendError(res, 403, 'Customer referrals are managed by the super admin');
        const data = await referrals.listReferees(req.params.referrerId, req.query || {});
        return sendResponse(res, 200, 'Referrals fetched', data);
    } catch (e) { next(e); }
}

export async function listZoneSettings(_req, res, next) {
    try {
        return sendResponse(res, 200, 'Zone referral settings fetched', await referrals.listReferralZoneSettings());
    } catch (e) { next(e); }
}

export async function upsertZoneSetting(req, res, next) {
    try {
        const zoneSetting = await referrals.upsertReferralZoneSetting(req.params.zoneId, req.body || {});
        return sendResponse(res, 200, 'Zone referral settings saved', { zoneSetting });
    } catch (e) { next(e); }
}

export async function deleteZoneSetting(req, res, next) {
    try {
        return sendResponse(res, 200, 'Zone referral settings removed', await referrals.deleteReferralZoneSetting(req.params.zoneId));
    } catch (e) { next(e); }
}
