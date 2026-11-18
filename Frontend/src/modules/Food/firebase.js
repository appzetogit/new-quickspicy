import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || ""
};

/**
 * The Firebase web config saved on the admin Firebase page, for a build made
 * without the VITE_FIREBASE_* values. Fills only the empty fields, and only
 * before Firebase starts. Returns whether live tracking can now start.
 */
export function applyRuntimeFirebaseConfig(saved = {}) {
  if (!app) {
    const fromAdmin = {
      apiKey: saved.apiKey,
      authDomain: saved.authDomain,
      projectId: saved.fcmProjectId || saved.projectId,
      appId: saved.appId,
      messagingSenderId: saved.messagingSenderId,
      storageBucket: saved.storageBucket,
      measurementId: saved.measurementId,
      databaseURL: saved.databaseURL,
    }
    for (const [k, v] of Object.entries(fromAdmin)) {
      if (!firebaseConfig[k] && typeof v === "string" && v.trim()) firebaseConfig[k] = v.trim()
    }
  }
  return hasRealtimeConfig()
}

/** True when there is enough config to start the Realtime Database. */
export const hasRealtimeConfig = () => Boolean(firebaseConfig.apiKey && firebaseConfig.databaseURL)

// Internal state
let app;
let firebaseAuth = null;
let googleProvider = null;
let firebaseRealtimeDb = null;

/**
 * Ensures Firebase app is initialized but stays silent.
 */
function initializeBaseApp() {
  if (app) return app;
  const existingApps = getApps();
  if (existingApps.length > 0) {
    app = existingApps[0];
  } else {
    app = initializeApp(firebaseConfig);
  }
  return app;
}

/**
 * Get the initialized Firebase Auth instance lazily.
 */
export function getFirebaseAuth() {
  if (!firebaseAuth) {
    const firebaseApp = initializeBaseApp();
    firebaseAuth = getAuth(firebaseApp);
  }
  return firebaseAuth;
}

/**
 * Get the initialized Google Auth Provider lazily.
 */
export function getGoogleAuthProvider() {
  if (!googleProvider) {
    googleProvider = new GoogleAuthProvider();
  }
  return googleProvider;
}

/**
 * Legacy support: ensuring Firebase is initialized.
 * Now it only initializes the basic App and Realtime DB if requested.
 * Auth initialization is skipped by default to avoid stale 'getProjectConfig' calls.
 */
export function ensureFirebaseInitialized(options = {}) {
  const { enableAuth = false, enableRealtimeDb = true } = options;
  const firebaseApp = initializeBaseApp();

  if (enableAuth) {
    getFirebaseAuth();
  }

  if (enableRealtimeDb && !firebaseRealtimeDb) {
    firebaseRealtimeDb = getDatabase(firebaseApp);
  }
  
  return firebaseApp;
}

// Proxies for export
export { app as firebaseApp, firebaseAuth, googleProvider, firebaseRealtimeDb };
