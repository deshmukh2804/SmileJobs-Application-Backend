const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.protect = async (req, res, next) => {
  try {
    let token = '';

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      console.log('[AUTH] No token provided in request to:', req.originalUrl);
      return res.status(401).json({
        success: false,
        message: 'Not authorized, no token provided',
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('[AUTH] Token decoded for user:', decoded.id, decoded.phoneNumber || decoded.email || '');

    // Attach ALL identifiers to request so controllers can fallback lookup
    req.user = {
      id: decoded.id,
      phoneNumber: decoded.phoneNumber || '',
      email: decoded.email || '',
      role: decoded.role || 'job_seeker',
    };

    // Verify user still exists — but don't reject if only ID is stale (fallback in controller)
    const user = await User.findById(decoded.id);
    if (!user) {
      // Try fallback lookup by phone/email before rejecting
      let fallbackUser = null;
      if (decoded.phoneNumber) {
        fallbackUser = await User.findOne({ phoneNumber: decoded.phoneNumber });
      }
      if (!fallbackUser && decoded.email) {
        fallbackUser = await User.findOne({ email: decoded.email });
      }

      if (fallbackUser) {
        console.log(`[AUTH] ⚠️ Stale JWT id ${decoded.id} → fallback matched real user ${fallbackUser._id}`);
        req.user.id = String(fallbackUser._id); // Fix the id so downstream code works
      } else {
        console.log('[AUTH] User not found in DB for id:', decoded.id);
        return res.status(401).json({
          success: false,
          message: 'User no longer exists',
        });
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