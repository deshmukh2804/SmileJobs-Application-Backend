const express = require('express');
const router = express.Router();

const { sendOTP, verifyOTP, googleLogin, getProfile } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

// Public
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);
router.post('/google', googleLogin);   // ✅ NEW: Google login

// Protected
router.get('/profile', protect, getProfile);

module.exports = router;