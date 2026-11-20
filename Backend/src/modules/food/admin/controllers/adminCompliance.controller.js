import * as zoneMaintenance from '../services/zoneMaintenance.service.js';
import {
    listExpiredFssaiRestaurants,
    listExpiringFssaiRestaurants,
    getFssaiComplianceSettings,
    updateFssaiComplianceSettings,
    FSSAI_WARNING_DAYS,
} from '../../restaurant/services/fssaiExpiry.service.js';

/**
 * Zone maintenance (all restaurants in a zone offline / back online) and the
 * FSSAI compliance page (expired and expiring licences, the ordering block).
 */

const send = (res, message, data) => res.status(200).json({ success: true, message, data });

/** GET /restaurants/zone-maintenance?zoneId= */
export async function getZoneMaintenance(req, res, next) {
    try { return send(res, 'Zone maintenance', await zoneMaintenance.getZoneMaintenance(req.query.zoneId)); } catch (e) { next(e); }
}

/** POST /restaurants/zone-maintenance/offline { zoneId } */
export async function takeZoneOffline(req, res, next) {
    try {
        const data = await zoneMaintenance.takeZoneOffline(req.body?.zoneId, req.user?.userId);
        return send(res, `${data.takenOffline} restaurant(s) taken offline`, data);
    } catch (e) { next(e); }
}

/** POST /restaurants/zone-maintenance/online { zoneId } */
export async function bringZoneOnline(req, res, next) {
    try {
        const data = await zoneMaintenance.bringZoneOnline(req.body?.zoneId);
        return send(res, `${data.broughtOnline} restaurant(s) back online`, data);
    } catch (e) { next(e); }
}

/** GET /restaurants/fssai-compliance: { expired, expiring, settings } */
export async function getFssaiCompliance(req, res, next) {
    try {
        const days = Math.min(Math.max(parseInt(req.query.days, 10) || FSSAI_WARNING_DAYS, 1), 365);
        const [expired, expiring, settings] = await Promise.all([
            listExpiredFssaiRestaurants(),
            listExpiringFssaiRestaurants(days),
            getFssaiComplianceSettings({ fresh: true }),
        ]);
        return send(res, 'FSSAI compliance', { expired, expiring, settings, days });
    } catch (e) { next(e); }
}

/** PUT /restaurants/fssai-compliance/settings { blockExpired } */
export async function updateFssaiCompliance(req, res, next) {
    try {
        const settings = await updateFssaiComplianceSettings(req.body || {});
        return send(res, settings.blockExpired ? 'Ordering blocked for expired FSSAI' : 'FSSAI ordering block off', settings);
    } catch (e) { next(e); }
}
