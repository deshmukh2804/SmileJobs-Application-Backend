const express = require('express');
const router = express.Router();

const {
  registerFcmToken,
  removeFcmToken,
  listFcmTokens,
} = require('../controllers/fcmController');
const { protect } = require('../middleware/authMiddleware');

// All FCM routes require authentication
router.post('/fcm-token', protect, registerFcmToken);
router.delete('/fcm-token', protect, removeFcmToken);
router.get('/fcm-tokens', protect, listFcmTokens); // For debugging

module.exports = router;