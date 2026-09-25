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
        message: 'Not authorized, no token provided',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('[AUTH] Token decoded:', decoded.id, decoded.phoneNumber || '');

    req.user = {
      id: decoded.id,
      phoneNumber: decoded.phoneNumber || '',
      email: decoded.email || '',
      role: decoded.role || 'job_seeker',
    };

    // Verify user exists in DB
    let user = await User.findById(decoded.id);

    if (!user) {
      // ── FALLBACK: JWT id is stale, find real user by phone/email ──
      if (decoded.phoneNumber) {
        user = await User.findOne({ phoneNumber: decoded.phoneNumber })
          .sort({ profileCompletion: -1, updatedAt: -1 });
      }
      if (!user && decoded.email) {
        user = await User.findOne({ email: decoded.email })
          .sort({ profileCompletion: -1, updatedAt: -1 });
      }

      if (user) {
        console.log(`[AUTH] ⚠️ Stale JWT id ${decoded.id} → corrected to ${user._id}`);
        req.user.id = String(user._id);
      } else {
        console.log('[AUTH] User not found for id:', decoded.id);
        return res.status(401).json({
          success: false,
          message: 'User no longer exists',
        });
      }
    } else {
      // ── CHECK: Is there a BETTER user with same phone? ──
      // This handles the case where JWT points to an empty duplicate
      if (decoded.phoneNumber) {
        const betterUser = await User.findOne({ phoneNumber: decoded.phoneNumber })
          .sort({ profileCompletion: -1, updatedAt: -1 });

        if (betterUser && String(betterUser._id) !== String(user._id)) {
          const currentCompletion = user.profileCompletion || 0;
          const betterCompletion = betterUser.profileCompletion || 0;

          if (betterCompletion > currentCompletion) {
            console.log(
              `[AUTH] 🔄 Switching from empty user ${user._id} (${currentCompletion}%) ` +
              `→ data-rich user ${betterUser._id} (${betterCompletion}%)`
            );
            req.user.id = String(betterUser._id);
          }
        }
      }
    }

    next();
  } catch (error) {
    console.log('[AUTH] Token verification failed:', error.message);
    return res.status(401).json({
      success: false,
      message: 'Not authorized, token invalid or expired',
    });
  }
};