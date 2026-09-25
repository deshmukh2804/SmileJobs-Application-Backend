const jwt = require('jsonwebtoken');
const User = require('../models/User');

// ✅ Aligned precisely with the controller signature keys!
const JWT_SECRET = process.env.JWT_SECRET || 'careerflow_production_jwt_secret_key_default';

const authMiddleware = async (req, res, next) => {
  try {
    let token = null;
    const authHeader = req.headers.authorization || req.headers.Authorization;

    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.headers['x-auth-token']) {
      token = req.headers['x-auth-token'];
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No authentication token provided.',
        code: 'TOKEN_MISSING',
      });
    }

    // Un-quote tokens wrapped with quotes to prevent invalid signatures
    const parsedToken = token.replace(/^"|"$/g, '').trim();

    let decoded;
    try {
      decoded = jwt.verify(parsedToken, JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Your session has expired. Please log in again.',
          code: 'TOKEN_EXPIRED',
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid authentication token.',
        code: 'TOKEN_INVALID',
      });
    }

    const userId = decoded.id || decoded._id || decoded.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token payload.',
        code: 'TOKEN_INVALID_PAYLOAD',
      });
    }

    const user = await User.findById(userId).select('_id role isVerified phoneNumber email name').lean();
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User account no longer exists.',
        code: 'USER_NOT_FOUND',
      });
    }

    req.user = {
      id: String(user._id),
      _id: user._id,
      role: user.role || 'job_seeker',
      isVerified: !!user.isVerified,
      phoneNumber: user.phoneNumber || '',
      email: user.email || '',
      name: user.name || '',
    };

    next();
  } catch (error) {
    console.error(`[AuthMiddleware] Fatal Error: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Authentication server error',
      code: 'AUTH_SERVER_ERROR',
    });
  }
};

const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }
  return authMiddleware(req, res, next);
};

const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Forbidden: Admin access required',
      code: 'FORBIDDEN_ADMIN_ONLY',
    });
  }
  next();
};

const socketAuthMiddleware = async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(' ')[1] ||
      socket.handshake.query?.token;

    if (!token) {
      return next(new Error('Authentication token required'));
    }

    const parsedToken = token.replace(/^"|"$/g, '').trim();

    let decoded;
    try {
      decoded = jwt.verify(parsedToken, JWT_SECRET);
    } catch (err) {
      return next(new Error('Session invalid or expired'));
    }

    const userId = decoded.id || decoded._id || decoded.userId;
    const user = await User.findById(userId).select('_id role').lean();
    if (!user) {
      return next(new Error('User account no longer exists'));
    }

    socket.userId = String(user._id);
    socket.userRole = user.role;

    next();
  } catch (err) {
    next(new Error('Internal connection authentication error'));
  }
};

authMiddleware.authMiddleware = authMiddleware;
authMiddleware.protect = authMiddleware;
authMiddleware.verifyToken = authMiddleware;
authMiddleware.authenticate = authMiddleware;
authMiddleware.requireAuth = authMiddleware;
authMiddleware.optionalAuth = optionalAuth;
authMiddleware.adminOnly = adminOnly;
authMiddleware.adminMiddleware = adminOnly;
authMiddleware.socketAuthMiddleware = socketAuthMiddleware;

module.exports = authMiddleware;