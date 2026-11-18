import { prisma } from '../../../../config/prisma.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { isId } from '../../../../utils/helpers.js';

/**
 * Settings pages that are a form and nothing else (App & Web, Login setup,
 * Theme, Email templates, Analytics, AI, Firebase, Withdraw methods, Wallet
 * bonus ...). Each page owns one key and stores its form as JSON.
 *
 * `public: true` serves the value (minus secrets) on /platform-settings/public
 * for the apps and the website; the rest are admin-only.
 *
 * Secrets (anything named like a key, token, secret or password) are masked
 * when read back, and a masked value sent back unchanged keeps the stored one,
 * so opening and saving a page never wipes a secret the admin cannot see.
 */
export const PLATFORM_SETTING_KEYS = {
    app_web: { public: true },
    // The web config's apiKey is public by design (it is in every page that
    // uses Firebase); the service account is the secret.
    firebase: { public: true, notSecret: ['apiKey'] },
    analytics: { public: true },
    ai: { public: false },
    react_site: { public: true },
    join_us: { public: true },
    login_setup: { public: true },
    email_templates: { public: false },
    theme: { public: true },
    react_registration: { public: true },
    offline_payment: { public: true },
    notification_channels: { public: false },
    addon_activation: { public: false },
    third_party: { public: false },
    withdraw_methods: { public: true },
    wallet_bonus: { public: true },
    landing_admin: { public: true },
    landing_react: { public: true },
};

const MAX_BYTES = 256 * 1024;
const MASK = '••••';
const SECRET_NAME = /secret|password|passwd|token|private_?key|server_?key|api_?key|auth_?key|access_?key|credential/i;

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Deep copy with every secret replaced: '••••' plus its last 4 characters. */
export function maskSecrets(value, notSecret = []) {
    if (Array.isArray(value)) return value.map((v) => maskSecrets(v));
    if (!isPlainObject(value)) return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (SECRET_NAME.test(k) && !notSecret.includes(k) && typeof v === 'string' && v) {
            out[k] = `${MASK}${v.slice(-4)}`;
        } else {
            out[k] = maskSecrets(v);
        }
    }
    return out;
}

/** Deep copy with every secret removed, for the public endpoint. */
export function stripSecrets(value, notSecret = []) {
    if (Array.isArray(value)) return value.map((v) => stripSecrets(v));
    if (!isPlainObject(value)) return value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (SECRET_NAME.test(k) && !notSecret.includes(k)) continue;
        out[k] = stripSecrets(v);
    }
    return out;
}

/** The incoming value, with masked secrets swapped back for the stored ones. */
export function keepMaskedSecrets(incoming, stored) {
    if (Array.isArray(incoming)) {
        return incoming.map((v, i) => keepMaskedSecrets(v, Array.isArray(stored) ? stored[i] : undefined));
    }
    if (!isPlainObject(incoming)) return incoming;
    const out = {};
    for (const [k, v] of Object.entries(incoming)) {
        const old = isPlainObject(stored) ? stored[k] : undefined;
        if (SECRET_NAME.test(k) && typeof v === 'string' && v.startsWith(MASK)) {
            out[k] = old ?? '';
        } else {
            out[k] = keepMaskedSecrets(v, old);
        }
    }
    return out;
}

const checkKey = (key) => {
    if (!Object.prototype.hasOwnProperty.call(PLATFORM_SETTING_KEYS, key)) {
        throw new ValidationError('Unknown settings page');
    }
    return key;
};

/** The stored value, unmasked. For server-side use only. */
export async function readPlatformSetting(key) {
    const row = await prisma.foodPlatformSetting.findUnique({ where: { key: checkKey(key) } });
    return row?.value ?? {};
}

export async function getPlatformSetting(key) {
    const row = await prisma.foodPlatformSetting.findUnique({ where: { key: checkKey(key) } });
    return { key, value: maskSecrets(row?.value ?? {}, (PLATFORM_SETTING_KEYS[key]?.notSecret || [])), updatedAt: row?.updatedAt ?? null };
}

export async function savePlatformSetting(key, value, adminId = null) {
    checkKey(key);
    if (!isPlainObject(value)) throw new ValidationError('Settings must be an object');
    const stored = await readPlatformSetting(key);
    const merged = keepMaskedSecrets(value, stored);
    if (key === 'firebase') checkFirebaseCredential(merged.serviceAccountCredential);
    if (Buffer.byteLength(JSON.stringify(merged), 'utf8') > MAX_BYTES) {
        throw new ValidationError('These settings are too large to save');
    }
    const row = await prisma.foodPlatformSetting.upsert({
        where: { key },
        create: { key, value: merged, updatedBy: isId(adminId) ? String(adminId) : null },
        update: { value: merged, updatedBy: isId(adminId) ? String(adminId) : null },
    });
    if (key === 'third_party') {
        // Payments and OTP use the new keys from the next request on.
        const { loadThirdPartyCredentials } = await import('../../../../core/config/adminCredentials.js');
        await loadThirdPartyCredentials({ force: true });
    }
    if (key === 'firebase') {
        // The next push signs in with what was just saved.
        const { resetFirebaseCredentialCache } = await import('../../../../core/notifications/firebase.service.js');
        resetFirebaseCredentialCache();
    }
    return { key, value: maskSecrets(row.value, (PLATFORM_SETTING_KEYS[key]?.notSecret || [])), updatedAt: row.updatedAt };
}

/**
 * The service-account JSON pasted on the Firebase page has to be usable: a
 * typo here would otherwise only show up as every push failing.
 */
function checkFirebaseCredential(raw) {
    if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) return;
    let account = raw;
    if (typeof raw === 'string') {
        try { account = JSON.parse(raw); } catch { throw new ValidationError('The service account must be the JSON file Firebase gives you, pasted whole'); }
    }
    if (!account?.client_email || !account?.private_key || !account?.project_id) {
        throw new ValidationError('That service account is missing client_email, private_key or project_id');
    }
}

/** Every public settings page, secrets removed: { [key]: value }. */
export async function getPublicPlatformSettings() {
    const keys = Object.entries(PLATFORM_SETTING_KEYS).filter(([, v]) => v.public).map(([k]) => k);
    const rows = await prisma.foodPlatformSetting.findMany({ where: { key: { in: keys } } });
    return Object.fromEntries(rows.map((r) => [r.key, stripSecrets(r.value, (PLATFORM_SETTING_KEYS[r.key]?.notSecret || []))]));
}
