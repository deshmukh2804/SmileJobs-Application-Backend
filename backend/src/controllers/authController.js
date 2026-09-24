const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const { generateOTP, verifyOTP, getDebugOTP } = require('../services/otpService');

// Initialize Google OAuth2Client with Web Client ID from environment variables
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      ...(debugOtp && { debugOtp }),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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
      user = await User.create({ phoneNumber, isVerified: true, authProvider: 'phone' });
      isNewUser = true;
    } else {
      user.isVerified = true;
      user.lastLogin = new Date();
      await user.save();
    }

    const token = jwt.sign(
      { id: user._id, phoneNumber: user.phoneNumber, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.status(200).json({
      success: true,
      message: isNewUser ? 'Account created!' : 'Welcome back!',
      isNewUser,
      token,
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

    // Verify the Token with Google OAuth
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID, // Audience matches your backend's Web Client ID configuration
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

    // Fallback search to handle email updates
    if (!user && email) {
      user = await User.findOne({ email });
    }

    if (user) {
      // Update account provider links on dynamic logins
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
        lastLogin: new Date(),
      });
      isNewUser = true;
    }

    const token = jwt.sign(
      { id: user._id, phoneNumber: user.phoneNumber || '', role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.status(200).json({
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
    res.status(401).json({
      success: false,
      message: 'Invalid Google ID token signature',
    });
  }
};

// ─────────────────────────────────
// 👤 GET /api/auth/profile
// ─────────────────────────────────
exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-__v');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};