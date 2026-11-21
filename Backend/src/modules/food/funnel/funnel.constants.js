/**
 * Customer acquisition funnel: the fixed list of events the apps and the
 * website may send to POST /food/events, and the stages the admin report
 * shows. Anything not listed here is ignored on the way in.
 */

export const FUNNEL_EVENTS = Object.freeze([
    'app_open',
    'restaurant_view',
    'menu_item_view',
    'add_to_cart',
    'checkout_start',
    'payment_success',
    'payment_failed',
]);

export const FUNNEL_EVENT_SET = new Set(FUNNEL_EVENTS);

/** The report's stages, in journey order. menu_item_view / payment_failed are extras. */
export const FUNNEL_STAGES = Object.freeze([
    { key: 'app_open', label: 'App open' },
    { key: 'restaurant_view', label: 'Restaurant browsing' },
    { key: 'add_to_cart', label: 'Added to cart' },
    { key: 'checkout_start', label: 'Checkout started' },
    { key: 'payment_success', label: 'Payment successful' },
]);

/** What the apps may send. 'unknown' is only ever written by the server. */
export const CLIENT_PLATFORMS = Object.freeze(['android', 'ios', 'web']);
export const PLATFORMS = Object.freeze([...CLIENT_PLATFORMS, 'unknown']);

export const MAX_EVENTS_PER_BATCH = 50;
/** Serialised props above this are dropped (the event itself is kept). */
export const MAX_PROPS_BYTES = 2048;
export const MAX_PROP_KEYS = 20;
export const RETENTION_DAYS = 180;

/** A client timestamp is trusted only this far back (offline batches) and ahead. */
export const MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_EVENT_SKEW_MS = 5 * 60 * 1000;

/** Session / device ids: what the apps generate (uuid, random hex ...). */
export const CLIENT_ID_RE = /^[A-Za-z0-9_.:-]{8,64}$/;
