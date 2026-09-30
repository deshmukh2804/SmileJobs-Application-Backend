const express = require('express');
const router = express.Router();

const {
  registerFcmToken,
  removeFcmToken,
  listFcmTokens,
} = require('../controllers/fcmController');

// ✅ FIXED: Corrected the path to your auth middleware
const { protect } = require('../middleware/authMiddleware');

// All FCM routes require authentication
router.post('/fcm-token', protect, registerFcmToken);

// Support both POST and DELETE for removing tokens depending on how your frontend calls it
router.post('/unregister-fcm', protect, removeFcmToken);
router.delete('/fcm-token', protect, removeFcmToken);

router.get('/fcm-tokens', protect, listFcmTokens); // For debugging

module.exports = router;