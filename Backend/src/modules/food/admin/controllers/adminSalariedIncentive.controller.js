import {
    getSalariedIncentiveSettings,
    saveSalariedIncentiveSettings,
} from '../../delivery/services/salariedIncentive.service.js';

/** GET /food/admin/fee-settings/salaried-incentive */
export async function getSalariedIncentiveController(req, res, next) {
    try {
        const data = await getSalariedIncentiveSettings();
        res.json({ success: true, message: 'Salaried rider incentive', data });
    } catch (err) {
        next(err);
    }
}

/** PUT /food/admin/fee-settings/salaried-incentive  { enabled, dailyThreshold, zones? } */
export async function saveSalariedIncentiveController(req, res, next) {
    try {
        const data = await saveSalariedIncentiveSettings(req.body || {}, req.user?.userId || null);
        res.json({ success: true, message: 'Salaried rider incentive saved', data });
    } catch (err) {
        next(err);
    }
}
