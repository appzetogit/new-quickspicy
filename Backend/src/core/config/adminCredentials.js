import { prisma } from '../../config/prisma.js';
import { logger } from '../../utils/logger.js';

/**
 * Service credentials saved on admin → 3rd Party → Payment & Services
 * (platform setting "third_party": { razorpay: { enabled, keyId, keySecret,
 * webhookSecret }, sms_india_hub: { ... }, twilio: { ... }, ... }).
 *
 * Environment variables always win; these fill in when the server has none,
 * so a service can be set up from the panel without a redeploy. A service is
 * only used once it is switched on there.
 *
 * Callers that must answer synchronously (isRazorpayConfigured is called all
 * over the order flow) read the cache. It is loaded at startup, refreshed once
 * a minute, and reloaded straight after the page is saved.
 */
const cache = { value: {}, loadedAt: 0 };
let refreshTimer = null;

export async function loadThirdPartyCredentials({ force = false } = {}) {
    if (!force && cache.loadedAt && Date.now() - cache.loadedAt < 60_000) return cache.value;
    try {
        const row = await prisma.foodPlatformSetting.findUnique({ where: { key: 'third_party' } });
        cache.value = row?.value && typeof row.value === 'object' ? row.value : {};
    } catch (error) {
        // Keep what we had: a database blip must not switch payments off.
        logger.warn(`3rd party credentials could not be loaded: ${error?.message || error}`);
    }
    cache.loadedAt = Date.now();
    return cache.value;
}

/** A switched-on service's saved fields, or null. */
export function thirdPartyService(name) {
    const service = cache.value?.[name];
    return service && typeof service === 'object' && service.enabled ? service : null;
}

/** Keeps the cache fresh in the background; the timer never holds the process open. */
export function startThirdPartyRefresh() {
    if (refreshTimer || process.env.NODE_ENV === 'test') return;
    refreshTimer = setInterval(() => { loadThirdPartyCredentials({ force: true }).catch(() => {}); }, 60_000);
    refreshTimer.unref?.();
}

/** Tests only: set the cache directly. */
export function __setThirdPartyForTests(value) {
    if (process.env.NODE_ENV !== 'test') throw new Error('for tests only');
    cache.value = value || {};
    cache.loadedAt = Date.now();
}
