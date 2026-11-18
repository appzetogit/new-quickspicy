import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

let db = null;
let messaging = null;
let cachedServiceAccount = null;
/** Where the running app's credential came from: 'env', 'admin' or null. */
let source = null;
/** client_email + databaseURL of the admin credential in use, to notice a change. */
let adminFingerprint = '';
let watchTimer = null;

const ADMIN_RECHECK_MS = 60_000;

const sanitizeString = (value) => String(value ?? '').trim();

const getServiceAccountFromEnv = () => {
    if (cachedServiceAccount) return cachedServiceAccount;

    const rawJson = sanitizeString(config.firebaseServiceAccount);
    if (rawJson) {
        try {
            cachedServiceAccount = JSON.parse(rawJson);
            return cachedServiceAccount;
        } catch (err) {
            logger.error('Error parsing FIREBASE_SERVICE_ACCOUNT JSON:', err.message);
        }
    }

    const pathValue = sanitizeString(config.firebaseServiceAccountPath);
    if (pathValue) {
        const filePath = resolve(process.cwd(), pathValue);
        if (existsSync(filePath)) {
            try {
                cachedServiceAccount = JSON.parse(readFileSync(filePath, 'utf8'));
                return cachedServiceAccount;
            } catch (err) {
                logger.error(`Error reading or parsing firebase service account file at ${filePath}:`, err.message);
            }
        }
    }

    return null;
};

/**
 * The service account and Realtime Database URL saved on the admin Firebase
 * page (platform setting "firebase"), used when the environment has none.
 */
const readAdminFirebase = async () => {
    try {
        const { prisma } = await import('./prisma.js');
        const row = await prisma.foodPlatformSetting.findUnique({ where: { key: 'firebase' } });
        const value = row?.value && typeof row.value === 'object' ? row.value : {};
        const raw = value.serviceAccountCredential;
        const parsed = typeof raw === 'string' && raw.trim() ? JSON.parse(raw) : raw && typeof raw === 'object' ? raw : null;
        return {
            serviceAccount: parsed?.client_email && parsed?.private_key ? parsed : null,
            databaseURL: sanitizeString(value.databaseURL),
        };
    } catch (error) {
        logger.warn(`Firebase settings on the admin page could not be read: ${error?.message || error}`);
        return { serviceAccount: null, databaseURL: '' };
    }
};

const stopApp = async () => {
    db = null;
    messaging = null;
    source = null;
    adminFingerprint = '';
    await Promise.all(admin.apps.map((app) => app?.delete().catch(() => {})));
};

const startApp = (serviceAccount, databaseURL, from) => {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: databaseURL || undefined,
    });
    // Without a database URL admin.database() throws; pushes still work.
    db = databaseURL ? admin.database() : null;
    messaging = admin.messaging();
    source = from;
    if (db) logger.info(`✅ Firebase Realtime Database initialized (credential from ${from === 'env' ? 'the environment' : 'the admin Firebase page'})`);
    else logger.warn('⚠️ Firebase initialized without a Realtime Database URL: live tracking through Firebase is off. Set it on the admin Firebase page.');
};

/**
 * While the credential comes from the admin page (or nowhere yet), look again
 * once a minute, so saving the Firebase page takes effect in every process --
 * the API, the socket server -- without a restart. An env credential is fixed
 * for the life of the process and needs no watching.
 */
const watchAdminSettings = () => {
    if (watchTimer || process.env.NODE_ENV === 'test') return;
    watchTimer = setInterval(() => { reloadFirebaseRealtime().catch(() => {}); }, ADMIN_RECHECK_MS);
    watchTimer.unref?.();
};

/**
 * Initializes Firebase Admin SDK (FCM and Realtime Database). The credential
 * comes from FIREBASE_SERVICE_ACCOUNT(_PATH) when set, else from the admin
 * Firebase page; the database URL likewise from VITE_FIREBASE_DATABASE_URL,
 * else from that page.
 */
export const initializeFirebaseRealtime = async () => {
    try {
        if (admin.apps.length > 0) {
            return db || messaging ? { db, messaging } : null;
        }

        const envAccount = getServiceAccountFromEnv();
        const envUrl = sanitizeString(config.firebaseDatabaseUrl);
        const saved = !envAccount || !envUrl ? await readAdminFirebase() : { serviceAccount: null, databaseURL: '' };

        const serviceAccount = envAccount || saved.serviceAccount;
        const databaseURL = envUrl || saved.databaseURL;

        if (!envAccount) watchAdminSettings();

        if (!serviceAccount) {
            logger.warn('⚠️ Firebase service account not configured (env or admin Firebase page). Firebase features may not work.');
            return null;
        }

        startApp(serviceAccount, databaseURL, envAccount ? 'env' : 'admin');
        if (!envAccount) adminFingerprint = `${serviceAccount.client_email}|${databaseURL}`;
        return { db, messaging };
    } catch (error) {
        logger.error(`❌ Firebase Initialization Error: ${error.message}`);
        return null;
    }
};

/**
 * Picks up a changed admin Firebase page: starts Firebase if it was not
 * running, restarts it on a different credential or database URL, and stops
 * it if the credential was removed. Does nothing when the env supplies it.
 */
export const reloadFirebaseRealtime = async () => {
    if (source === 'env' || getServiceAccountFromEnv()) return;
    const saved = await readAdminFirebase();
    const databaseURL = sanitizeString(config.firebaseDatabaseUrl) || saved.databaseURL;
    const fingerprint = saved.serviceAccount ? `${saved.serviceAccount.client_email}|${databaseURL}` : '';
    if (fingerprint === adminFingerprint && (fingerprint === '' || admin.apps.length > 0)) return;

    try {
        await stopApp();
        if (!saved.serviceAccount) {
            logger.warn('Firebase credential removed from the admin page; Firebase is now off.');
            return;
        }
        startApp(saved.serviceAccount, databaseURL, 'admin');
        adminFingerprint = fingerprint;
    } catch (error) {
        logger.error(`❌ Firebase re-initialization failed: ${error.message}`);
    }
};

/**
 * Returns the initialized Firebase Realtime Database instance.
 * @returns {admin.database.Database}
 * @throws Error if not initialized
 */
export const getFirebaseDB = () => {
    if (!db) {
        throw new Error('⚠️ Firebase Realtime Database not initialized. Call initializeFirebaseRealtime() first.');
    }
    return db;
};

/**
 * Returns the initialized Firebase Messaging instance.
 * @returns {admin.messaging.Messaging}
 * @throws Error if not initialized
 */
export const getFirebaseMessaging = () => {
    if (!messaging) {
        throw new Error('⚠️ Firebase Messaging not initialized. Call initializeFirebaseRealtime() first.');
    }
    return messaging;
};

export default admin;
