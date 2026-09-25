const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.protect = async (req, res, next) => {
  try {
    let token = '';

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        code: 'NO_TOKEN',
        message: 'Not authorized, no token provided',
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtErr) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_TOKEN',
        message: 'Session expired. Please login again.',
      });
    }

    console.log('[AUTH]', decoded.id, decoded.phoneNumber || decoded.email || '');

    // ── STEP 1: Try to find user by JWT id ──
    let user = await User.findById(decoded.id).select('_id phoneNumber email role profileCompletion');

    // ── STEP 2: If not found → try fallback by phoneNumber/email ──
    if (!user) {
      console.log('[AUTH] ⚠️ Stale JWT id:', decoded.id, '→ trying fallback');

      if (decoded.phoneNumber) {
        user = await User.findOne({ phoneNumber: decoded.phoneNumber })
          .sort({ profileCompletion: -1, updatedAt: -1 })
          .select('_id phoneNumber email role profileCompletion');
      }
      if (!user && decoded.email) {
        user = await User.findOne({ email: decoded.email })
          .sort({ profileCompletion: -1, updatedAt: -1 })
          .select('_id phoneNumber email role profileCompletion');
      }

      if (user) {
        console.log('[AUTH] ✅ Recovered stale JWT → real user:', String(user._id));
      } else {
        console.log('[AUTH] ❌ No user found for stale JWT');
        return res.status(401).json({
          success: false,
          code: 'USER_NOT_FOUND',
          message: 'Account no longer exists. Please login again.',
        });
      }
    } else if (decoded.phoneNumber) {
      // ── STEP 3: SAFETY — if there's a BETTER user with same phone (duplicate), use that one ──
      const better = await User.findOne({
        phoneNumber: decoded.phoneNumber,
        _id: { $ne: user._id },
      })
        .sort({ profileCompletion: -1, updatedAt: -1 })
        .select('_id profileCompletion');

      if (better && (better.profileCompletion || 0) > (user.profileCompletion || 0)) {
        console.log(
          '[AUTH] 🔄 Switching to data-rich duplicate:',
          String(user._id), '→', String(better._id),
          `(${better.profileCompletion}% vs ${user.profileCompletion || 0}%)`
        );
        user = better;
      }
    }

    // Attach to request
    req.user = {
      id: String(user._id),
      phoneNumber: user.phoneNumber || decoded.phoneNumber || '',
      email: user.email || decoded.email || '',
      role: user.role || decoded.role || 'job_seeker',
    };

    next();
  } catch (error) {
    console.error('[AUTH] Fatal middleware error:', error.message);
    return res.status(500).json({
      success: false,
      code: 'AUTH_ERROR',
      message: 'Authentication service temporarily unavailable',
    });
  }
};