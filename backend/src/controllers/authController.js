const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const { generateOTP, verifyOTP, getDebugOTP } = require('../services/otpService');
const {
  generateEmailOTP,
  verifyEmailOTP,
  canResendEmailOTP,
  getDebugEmailOTP,
} = require('../services/emailOtpService');
const { sendEmail, wrapEmailTemplate, isValidDeliverableEmail } = require('../utils/mailer');

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

    const allUsers = await User.find({ phoneNumber })
      .sort({ profileCompletion: -1, updatedAt: -1 });

    let user;
    let isNewUser = false;

    if (allUsers.length === 0) {
      user = await User.create({
        phoneNumber,
        isVerified: true,
        authProvider: 'phone',
        role: 'job_seeker',
      });
      isNewUser = true;
      console.log(`[Auth] ✅ NEW user: ${phoneNumber} → ${user._id}`);
    } else {
      user = allUsers[0];
      user.isVerified = true;
      user.lastLogin = new Date();
      await user.save();
      console.log(
        `[Auth] ✅ LOGIN: ${phoneNumber} → ${user._id} (${user.profileCompletion || 0}%)`
      );

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
// 📧 POST /api/auth/send-email-otp
// ─────────────────────────────────
exports.sendEmailOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !isValidDeliverableEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address',
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    // Check rate limit
    const rateCheck = canResendEmailOTP(cleanEmail);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        message: `Please wait ${rateCheck.waitSeconds}s before requesting another OTP`,
      });
    }

    const otp = generateEmailOTP(cleanEmail);
    console.log(`📩 EMAIL OTP → ${cleanEmail} : ${otp}`);

    // Dynamic Branded email body template
    const emailBody = `
      <h2 style="margin:0 0 12px;color:#42326E;font-size:22px;font-weight:800;">
        Your Login Verification Code
      </h2>
      <p style="margin:0 0 16px;color:#555;font-size:14px;line-height:1.5;">
        Hi there,<br/>
        Use the following 4-digit One-Time Password (OTP) to securely access your <b>Smile Jobs / CareerFlow</b> account.
      </p>
      <div style="text-align:center;margin:24px 0;">
        <div style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%);border-radius:12px;">
          <span style="font-size:36px;font-weight:900;color:#ffffff;letter-spacing:12px;padding-left:12px;">${otp}</span>
        </div>
      </div>
      <p style="margin:16px 0 8px;color:#666;font-size:13px;">
        This code expires in <b>5 minutes</b>. Do not reply to this message or share this OTP with anyone for security.
      </p>
    `;

    const htmlContent = wrapEmailTemplate(emailBody, {
      heading: 'Login Verification Code',
      footerNote: 'Need help? Contact the support team.',
    });

    const mailResult = await sendEmail({
      to: cleanEmail,
      subject: `${otp} is your verification code`,
      html: htmlContent,
      recipientName: cleanEmail.split('@')[0],
    });

    if (!mailResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to dispatch email. Check SMTP server.',
      });
    }

    const debugOtp = getDebugEmailOTP(cleanEmail);

    return res.status(200).json({
      success: true,
      message: 'OTP sent to your email successfully',
      ...(debugOtp && { debugOtp }),
    });
  } catch (error) {
    console.error('❌ Error sending Email OTP:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────
// ✅ POST /api/auth/verify-email-otp
// ─────────────────────────────────
exports.verifyEmailOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP code are required',
      });
    }

    const cleanEmail = email.toLowerCase().trim();

    const otpResult = verifyEmailOTP(cleanEmail, otp);
    if (!otpResult.success) {
      return res.status(401).json({ success: false, message: otpResult.message });
    }

    const allUsers = await User.find({ email: cleanEmail })
      .sort({ profileCompletion: -1, updatedAt: -1 });

    let user;
    let isNewUser = false;

    if (allUsers.length === 0) {
      user = await User.create({
        email: cleanEmail,
        isVerified: true,
        authProvider: 'email',
        role: 'job_seeker',
        lastLogin: new Date(),
      });
      isNewUser = true;
      console.log(`[Auth] ✅ NEW email user: ${cleanEmail} → ${user._id}`);
    } else {
      user = allUsers[0];
      user.isVerified = true;
      user.lastLogin = new Date();

      if (user.authProvider && user.authProvider !== 'email' && user.authProvider !== 'both') {
        user.authProvider = 'both';
      } else if (!user.authProvider) {
        user.authProvider = 'email';
      }

      await user.save();
      console.log(`[Auth] ✅ LOGIN email user: ${cleanEmail} → ${user._id}`);

      if (allUsers.length > 1) {
        const dupIds = allUsers.slice(1).map((u) => u._id);
        User.deleteMany({ _id: { $in: dupIds } })
          .then(() => console.log(`[Auth] 🧹 Removed ${dupIds.length} duplicate email users`))
          .catch((err) => console.log('[Auth] Duplicate cleanup error:', err.message));
      }
    }

    const token = generateAuthToken(user);

    return res.status(200).json({
      success: true,
      message: isNewUser ? 'Account created successfully!' : 'Welcome back!',
      isNewUser,
      token,
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber || '',
        name: user.name || '',
        email: user.email,
        avatarUrl: user.avatarUrl || '',
        role: user.role,
        profileCompletion: user.profileCompletion || 0,
      },
    });
  } catch (error) {
    console.error('❌ verifyEmailOTP error:', error);
    return res.status(500).json({ success: false, message: 'Server verification failed.' });
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