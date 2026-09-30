// routes/notificationRoutes.js
const express = require('express');
const router = express.Router();

// Adjust the path to your auth middleware
const { protect } = require('../middlewares/auth'); 

// Import your FCM controller functions (Ensure this path points to your controller)
const { registerFcmToken, removeFcmToken, listFcmTokens } = require('../controllers/fcmController');

// ─────────────────────────────────────────────
// /api/notifications ROUTES
// ─────────────────────────────────────────────
router.post('/fcm-token', protect, registerFcmToken);
router.post('/unregister-fcm', protect, removeFcmToken);
router.get('/fcm-tokens', protect, listFcmTokens);

module.exports = router;