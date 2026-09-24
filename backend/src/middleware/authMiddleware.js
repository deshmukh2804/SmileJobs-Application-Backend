const jwt = require('jsonwebtoken');
const User = require('../models/User');

exports.protect = async (req, res, next) => {
  try {
    let token = '';

    // Extract token from Authorization header
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
    console.log('[AUTH] Token decoded for user:', decoded.id);

    // Attach user to request
    req.user = {
      id: decoded.id,
      phoneNumber: decoded.phoneNumber,
      role: decoded.role,
    };

    // Verify user still exists in DB
    const user = await User.findById(decoded.id);
    if (!user) {
      console.log('[AUTH] User not found in DB for id:', decoded.id);
      return res.status(401).json({
        success: false,
        message: 'User no longer exists',
      });
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