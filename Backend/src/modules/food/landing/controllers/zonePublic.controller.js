import { prisma } from '../../../../config/prisma.js';
import { getRedisClient } from '../../../../config/redis.js';
import { findZoneForPoint } from '../../shared/zone.service.js';
import { getServiceStatus } from '../../admin/services/businessSettings.service.js';

const ACTIVE_ZONES_CACHE_KEY = 'zones:active:list:v1';
const ACTIVE_ZONES_CACHE_TTL_SECONDS = 120;

const toFinite = (v) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
};

const getCachedJson = async (key) => {
    const redis = getRedisClient();
    if (!redis?.isReady || !key) return null;

    const raw = await redis.get(key);
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

const setCachedJson = async (key, value, ttlSeconds) => {
    const redis = getRedisClient();
    if (!redis?.isReady || !key) return;
    await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
};

export const invalidateActiveZonesCache = async () => {
    const redis = getRedisClient();
    if (!redis?.isReady) return;
    await redis.del(ACTIVE_ZONES_CACHE_KEY);
};

const getActiveZones = async () => {
    const cached = await getCachedJson(ACTIVE_ZONES_CACHE_KEY);
    if (Array.isArray(cached)) return cached;

    const zones = await prisma.foodZone.findMany({ where: { isActive: true } });
    await setCachedJson(ACTIVE_ZONES_CACHE_KEY, zones, ACTIVE_ZONES_CACHE_TTL_SECONDS);
    return zones;
};

/** The subset the onboarding selects and the map overlay actually read. */
const toPublicZone = (zone) => ({
    _id: zone.id || zone._id,
    name: zone.name,
    zoneName: zone.zoneName,
    serviceLocation: zone.serviceLocation,
    country: zone.country,
    unit: zone.unit,
    isActive: zone.isActive,
    coordinates: zone.coordinates,
    createdAt: zone.createdAt,
});

/** GET /zones/detect?lat=..&lng=.. */
export const detectZonePublicController = async (req, res, next) => {
    try {
        const lat = toFinite(req.query.lat);
        const lng = toFinite(req.query.lng);
        if (lat === null || lng === null) {
            return res.status(400).json({ success: false, message: 'lat and lng are required' });
        }

        // Answered fresh every time. A 3-minute cache keyed on the rounded
        // point kept giving the old answer after a zone was drawn or edited,
        // so a new zone looked like it worked only once. The lookup is one
        // indexed query.
        // One GIST-indexed containment test. This used to load every active zone
        // and walk each ring edge-by-edge in Node, which also meant the answer
        // depended on zone insertion order when two zones overlapped —
        // findZoneForPoint returns the tightest match instead.
        const match = await findZoneForPoint(lat, lng);
        const zone = match
            ? await prisma.foodZone.findUnique({ where: { id: match.id } })
            : null;

        // Admin "Pause orders" for this zone (or everywhere): the apps show a
        // popup/banner with the message instead of letting the customer reach checkout.
        const serviceStatus = await getServiceStatus(zone ? [zone.id] : []);
        const pauseFields = {
            servicePaused: serviceStatus.paused,
            serviceMessage: serviceStatus.message,
            resumeAt: serviceStatus.resumeAt,
            serviceStatus,
        };

        const response = zone
            ? {
                success: true,
                message: 'Zone detected',
                // zoneId is the tightest zone (a small zone when inside one);
                // mainZoneId is the main zone the customer is in.
                data: {
                    status: 'IN_SERVICE', zoneId: zone.id, mainZoneId: zone.parentZoneId || zone.id, zone, ...pauseFields,
                },
            }
            : {
                success: true,
                message: 'Out of service',
                data: { status: 'OUT_OF_SERVICE', zoneId: null, zone: null, ...pauseFields },
            };

        return res.status(200).json(response);
    } catch (error) {
        next(error);
    }
};

/** GET /zones/public — active zones for onboarding selects */
export const listZonesPublicController = async (_req, res, next) => {
    try {
        const zones = await getActiveZones();
        return res.status(200).json({
            success: true,
            message: 'Zones fetched successfully',
            data: { zones: zones.map(toPublicZone) },
        });
    } catch (error) {
        next(error);
    }
};

/** GET /zones/nearby — the same list, for the hotspot overlay */
export const listZonesNearbyPublicController = async (_req, res, next) => {
    try {
        const zones = await getActiveZones();
        return res.status(200).json({
            success: true,
            message: 'Nearby zones fetched',
            data: { zones: zones.map(toPublicZone) },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /public/service-status?lat=..&lng=.. or ?zoneId=..
 * { paused, servicePaused, message, resumeAt, scope, zoneId }: whether the
 * admin has paused ordering where this customer is. Public: the home screen
 * shows it before sign-in.
 */
export const serviceStatusPublicController = async (req, res, next) => {
    try {
        let zoneId = /^[a-f0-9]{24}$/i.test(String(req.query.zoneId || '')) ? String(req.query.zoneId) : null;
        if (!zoneId) {
            const lat = toFinite(req.query.lat);
            const lng = toFinite(req.query.lng);
            if (lat !== null && lng !== null) {
                zoneId = (await findZoneForPoint(lat, lng))?.id || null;
            }
        }
        const status = await getServiceStatus(zoneId ? [zoneId] : []);
        return res.status(200).json({ success: true, message: 'Service status', data: { ...status, zoneId } });
    } catch (error) {
        next(error);
    }
};
