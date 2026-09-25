const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');

// Resolve middleware whether imported as function or object
const auth = typeof authMiddleware === 'function' ? authMiddleware : (authMiddleware.authMiddleware || authMiddleware.protect);

// Helper to safely resolve controller handler
const resolveHandler = (fnName, fallbackFn) => {
  if (authController && typeof authController[fnName] === 'function') {
    return authController[fnName];
  }
  if (typeof fallbackFn === 'function') {
    return fallbackFn;
  }
  return (req, res) => res.status(501).json({ success: false, message: `Handler ${fnName} not implemented` });
};

// ── Auth Endpoints ──
const sendOTPHandler = resolveHandler('sendOTP', resolveHandler('sendOtp'));
const verifyOTPHandler = resolveHandler('verifyOTP', resolveHandler('verifyOtp'));
const googleHandler = resolveHandler('googleAuth', resolveHandler('google', resolveHandler('googleLogin')));
const getProfileHandler = resolveHandler('getProfile', resolveHandler('getMyProfile', resolveHandler('me', resolveHandler('profile'))));

router.post('/send-otp', sendOTPHandler);
router.post('/verify-otp', verifyOTPHandler);
router.post('/google', googleHandler);
router.get('/profile', auth, getProfileHandler);
router.get('/me', auth, getProfileHandler);

module.exports = router;