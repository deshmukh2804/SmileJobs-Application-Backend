const { initializeApp, cert, getApps } = require('firebase-admin/app');
const path = require('path');
const fs = require('fs');

let firebaseApp = null;
let initAttempted = false;

/**
 * Normalize a private key from an env variable.
 * Handles all common Render / dotenv formats:
 *  - Real newlines (Render "multiline" mode)
 *  - Escaped \n literals (Render "single-line" mode)
 *  - Wrapped in surrounding quotes
 */
function normalizePrivateKey(rawKey) {
  if (!rawKey) return '';
  let key = String(rawKey).trim();

  // Strip surrounding quotes if present
  if ((key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }

  // Convert escaped \n literals into real newlines
  if (key.includes('\\n')) {
    key = key.replace(/\\n/g, '\n');
  }

  return key;
}

function initFirebaseAdmin() {
  // Return existing app if already initialized (prevents duplicate init crash)
  if (firebaseApp) return firebaseApp;
  if (getApps().length > 0) {
    firebaseApp = getApps()[0];
    return firebaseApp;
  }

  // Only run init logic once per process
  if (initAttempted) return null;
  initAttempted = true;

  try {
    // ── PRIORITY 1: Local JSON service account file (backward compatible for dev) ──
    const serviceAccountPath = path.join(__dirname, '../../firebase-service-account.json');

    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = require(serviceAccountPath);
      firebaseApp = initializeApp({
        credential: cert(serviceAccount),
      });
      console.log('[Firebase] Admin SDK initialized (from JSON file)');
      return firebaseApp;
    }

    // ── PRIORITY 2: Environment variables (Render production) ──
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

    console.log('[Firebase] Checking production configuration...');
    console.log(`[Firebase] Project ID configured: ${!!projectId}`);
    console.log(`[Firebase] Client email configured: ${!!clientEmail}`);
    console.log(`[Firebase] Private key configured: ${!!privateKeyRaw}`);

    if (!projectId || !clientEmail || !privateKeyRaw) {
      const missing = [];
      if (!projectId) missing.push('FIREBASE_PROJECT_ID');
      if (!clientEmail) missing.push('FIREBASE_CLIENT_EMAIL');
      if (!privateKeyRaw) missing.push('FIREBASE_PRIVATE_KEY');
      console.warn(`⚠️ Firebase Admin NOT initialized: missing env var(s): ${missing.join(', ')}`);
      return null;
    }

    const privateKey = normalizePrivateKey(privateKeyRaw);

    // Sanity-check: private key must contain proper PEM markers
    if (!privateKey.includes('BEGIN PRIVATE KEY') || !privateKey.includes('END PRIVATE KEY')) {
      console.warn('⚠️ Firebase Admin NOT initialized: FIREBASE_PRIVATE_KEY is malformed (missing PEM markers).');
      return null;
    }

    firebaseApp = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });

    console.log('[Firebase] ✅ Admin SDK initialized successfully (from environment variables)');
    return firebaseApp;
  } catch (err) {
    console.error('❌ Firebase Admin init error:', err.message);
    return null;
  }
}

module.exports = { initFirebaseAdmin };