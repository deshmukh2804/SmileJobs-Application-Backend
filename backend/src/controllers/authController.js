const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const { generateOTP, verifyOTP, getDebugOTP } = require('../services/otpService');

const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ||
  '220136080079-jgj4u2up1ntj3ovg29f806rg3sl7c9vf.apps.googleusercontent.com';

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const generateAuthToken = (user) => {
  const secret = process.env.JWT_SECRET || 'careerflow_production_jwt_secret_key_default';
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
// Production-safe: handles duplicate users automatically
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

    // ── Find ALL users with this phone (handles duplicates) ──
    const allUsers = await User.find({ phoneNumber })
      .sort({ profileCompletion: -1, updatedAt: -1 });

    let user;
    let isNewUser = false;

    if (allUsers.length === 0) {
      // New user
      user = await User.create({
        phoneNumber,
        isVerified: true,
        authProvider: 'phone',
        role: 'job_seeker',
      });
      isNewUser = true;
      console.log(`[Auth] ✅ NEW user: ${phoneNumber} → ${user._id}`);
    } else {
      // Pick the user with most complete profile
      user = allUsers[0];
      user.isVerified = true;
      user.lastLogin = new Date();
      await user.save();
      console.log(
        `[Auth] ✅ LOGIN: ${phoneNumber} → ${user._id} (${user.profileCompletion || 0}%)`
      );

      // Clean up duplicates in background (don't wait)
      if (allUsers.length > 1) {
        const dupIds = allUsers.slice(1).map((u) => u._id);
        User.deleteMany({ _id: { $in: dupIds } })
          .then(() => console.log(`[Auth] 🧹 Removed ${dupIds.length} duplicate(s) for ${phoneNumber}`))
          .catch((err) => console.log('[Auth] Cleanup error:', err.message));
      }
    }

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
        email: user.email || '',
        avatarUrl: user.avatarUrl || '',
        role: user.role,
        profileCompletion: user.profileCompletion || 0,
      },
    });
  } catch (error) {
    console.error('❌ verifyOTP error:', error);
    return res.status(500).json({ success: false, message: 'Login temporarily failed. Try again.' });
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
// 👤 GET /api/auth/profile
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