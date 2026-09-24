const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const { generateOTP, verifyOTP, getDebugOTP } = require('../services/otpService');

// Web Client ID fallback to prevent audience mismatch errors
const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ||
  '220136080079-jgj4u2up1ntj3ovg29f806rg3sl7c9vf.apps.googleusercontent.com';

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// ── Centralized Safe JWT Signer ──
const generateAuthToken = (user) => {
  const secret = process.env.JWT_SECRET || 'careerflow_production_jwt_secret_key_default';
  // Handles JWT_EXPIRES_IN, JWT_EXPIRE or safely defaults to '30d'
  const expiresIn = process.env.JWT_EXPIRES_IN || process.env.JWT_EXPIRE || '30d';

  return jwt.sign(
    {
      id: user._id,
      phoneNumber: user.phoneNumber || '',
      email: user.email || '',
      role: user.role || 'job_seeker',
    },
    secret,
    { expiresIn }
  );
};

// ─────────────────────────────────
// 📱 POST /api/auth/send-otp
// ─────────────────────────────────
exports.sendOTP = async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber || !/^[0-9]{10}$/.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid 10-digit phone number',
      });
    }

    const otp = generateOTP(phoneNumber);
    console.log(`📩 SMS → +91 ${phoneNumber} : ${otp}`);

    const debugOtp = getDebugOTP(phoneNumber);

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      ...(debugOtp && { debugOtp }),
    });
  } catch (error) {
    console.error('❌ Error sending OTP:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────
// ✅ POST /api/auth/verify-otp
// ─────────────────────────────────
exports.verifyOTP = async (req, res) => {
  try {
    const { phoneNumber, otp } = req.body;

    if (!phoneNumber || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and OTP are required',
      });
    }

    const otpResult = verifyOTP(phoneNumber, otp);
    if (!otpResult.success) {
      return res.status(401).json({ success: false, message: otpResult.message });
    }

    let user = await User.findOne({ phoneNumber });
    let isNewUser = false;

    if (!user) {
      user = await User.create({
        phoneNumber,
        isVerified: true,
        authProvider: 'phone',
        role: 'job_seeker',
      });
      isNewUser = true;
    } else {
      user.isVerified = true;
      user.lastLogin = new Date();
      await user.save();
    }

    // Generate JWT token safely
    const token = generateAuthToken(user);

    return res.status(200).json({
      success: true,
      message: isNewUser ? 'Account created!' : 'Welcome back!',
      isNewUser,
      token,
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        name: user.name || '',
        role: user.role,
      },
    });
  } catch (error) {
    console.error('❌ Error verifying OTP:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────
// 🔵 POST /api/auth/google
// ─────────────────────────────────
exports.googleLogin = async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: 'Google ID token is required',
      });
    }

    // Verify token with Google OAuth
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      return res.status(401).json({
        success: false,
        message: 'Token verification failed. Payload is empty.',
      });
    }

    const googleId = payload.sub;
    const email = payload.email || '';
    const name = payload.name || '';
    const picture = payload.picture || '';

    let user = await User.findOne({ googleId });
    let isNewUser = false;

    // Fallback lookup by email
    if (!user && email) {
      user = await User.findOne({ email });
    }

    if (user) {
      if (!user.googleId) {
        user.googleId = googleId;
        user.authProvider = user.phoneNumber ? 'both' : 'google';
      }
      if (!user.name && name) user.name = name;
      if (!user.email && email) user.email = email;
      if (!user.avatarUrl && picture) user.avatarUrl = picture;
      user.isVerified = true;
      user.lastLogin = new Date();
      await user.save();
    } else {
      user = await User.create({
        googleId,
        email,
        name,
        avatarUrl: picture,
        authProvider: 'google',
        isVerified: true,
        role: 'job_seeker',
        lastLogin: new Date(),
      });
      isNewUser = true;
    }

    // Generate token safely
    const token = generateAuthToken(user);

    return res.status(200).json({
      success: true,
      message: isNewUser ? 'Account created with Google!' : 'Welcome back!',
      isNewUser,
      token,
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber || '',
        name: user.name,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (error) {
    console.error('❌ Google verification API error:', error.message);
    return res.status(401).json({
      success: false,
      message: error.message || 'Invalid Google ID token signature',
    });
  }
};

// ─────────────────────────────────
// 👤 GET /api/auth/profile/me
// ─────────────────────────────────
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    const user = await User.findById(userId).select('-__v');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.status(200).json({ success: true, user });
  } catch (error) {
    console.error('❌ Error getting profile:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};