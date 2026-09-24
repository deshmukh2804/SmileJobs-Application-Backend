const { initializeApp, cert, getApps } = require('firebase-admin/app');
const path = require('path');
const fs = require('fs');

let firebaseApp = null;

function initFirebaseAdmin() {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  try {
    const serviceAccountPath = path.join(__dirname, '../../firebase-service-account.json');

    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = require(serviceAccountPath);
      firebaseApp = initializeApp({
        credential: cert(serviceAccount),
      });
      console.log('✅ Firebase Admin initialized (from JSON file)');
    } else if (
      process.env.FIREBASE_PROJECT_ID &&
      process.env.FIREBASE_CLIENT_EMAIL &&
      process.env.FIREBASE_PRIVATE_KEY
    ) {
      firebaseApp = initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
      console.log('✅ Firebase Admin initialized (from environment variables)');
    } else {
      console.warn('⚠️ Firebase Admin NOT initialized: no service account found.');
      return null;
    }

    return firebaseApp;
  } catch (err) {
    console.error('❌ Firebase Admin init error:', err.message);
    return null;
  }
}

module.exports = { initFirebaseAdmin };