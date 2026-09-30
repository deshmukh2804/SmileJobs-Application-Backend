const express = require('express');
const router = express.Router();

const {
  registerFcmToken,
  removeFcmToken,
  listFcmTokens,
} = require('../controllers/fcmController');

// Correct import path for your auth middleware
const { protect } = require('../middleware/authMiddleware');

// All FCM routes require authentication
router.post('/fcm-token', protect, registerFcmToken);

// Handles unregistering FCM tokens on logout (supports both POST and DELETE)
router.post('/unregister-fcm', protect, removeFcmToken);
router.delete('/fcm-token', protect, removeFcmToken);

// For debugging active device tokens
router.get('/fcm-tokens', protect, listFcmTokens);

module.exports = router;