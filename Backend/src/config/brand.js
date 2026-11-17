// Imported for its side effect: env.js runs dotenv, so FRONTEND_URL is read
// from .env even when this module is the first config file loaded.
import './env.js';

/**
 * The image shown on push notifications when there is no better one.
 *
 * The Quick Spicy badge, served by the web app itself (Frontend/public/brand),
 * so a phone can fetch it when the notification arrives without any bucket
 * being public.
 *
 * Set PUSH_BRAND_IMAGE_URL to use a different image without a code change.
 */
const webOrigin = String(process.env.FRONTEND_URL || 'https://new.quickspicy.in').replace(/\/+$/, '');

export const BRAND_IMAGE_URL =
    process.env.PUSH_BRAND_IMAGE_URL
    || `${webOrigin}/brand/push-logo.webp`;
