const jwt = require('jsonwebtoken');
const User = require('../models/User');

// ─────────────────────────────────────────────────────────────
// JWT SECRET CONFIGURATION
// ─────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'careerflow_production_jwt_secret_key_default';

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('⚠️ [SECURITY WARNING] process.env.JWT_SECRET is not set. Using fallback secret in production is unsafe.');
}

// ─────────────────────────────────────────────────────────────
// CORE AUTHENTICATION MIDDLEWARE
// ─────────────────────────────────────────────────────────────
const authMiddleware = async (req, res, next) => {
  try {
    let token = null;
    const authHeader = req.headers.authorization || req.headers.Authorization;

    // 1. Extract Token from Authorization Header, custom header, or query parameter
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

    // 2. Un-quote tokens wrapped with quotes to prevent invalid signature rejections
    const parsedToken = String(token).replace(/^"|"$/g, '').trim();

    // 3. Verify JWT signature & expiration
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

    // 4. Extract authoritative MongoDB User ID
    const userId = decoded.userId || decoded.id || decoded._id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token payload: user identifier missing.',
        code: 'TOKEN_INVALID_PAYLOAD',
      });
    }

    // 5. Look up MongoDB user directly by authoritative ID
    const user = await User.findById(userId)
      .select('_id role isVerified phoneNumber phone email name authProvider')
      .lean();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User account belonging to this token no longer exists.',
        code: 'USER_NOT_FOUND',
      });
    }

    // 6. Bind authenticated user session identity to req.user
    req.user = {
      id: String(user._id),
      _id: user._id,
      role: user.role || 'job_seeker',
      isVerified: Boolean(user.isVerified),
      phoneNumber: user.phoneNumber || user.phone || '',
      phone: user.phone || user.phoneNumber || '',
      email: user.email || '',
      name: user.name || '',
      authProvider: user.authProvider || 'phone',
    };

    next();
  } catch (error) {
    console.error(`❌ [AuthMiddleware Error]: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Internal authentication server error',
      code: 'AUTH_SERVER_ERROR',
    });
  }
};

// ─────────────────────────────────────────────────────────────
// OPTIONAL AUTH MIDDLEWARE (For public/preview routes)
// ─────────────────────────────────────────────────────────────
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];
  if (!token) return next();

  const parsedToken = String(token).replace(/^"|"$/g, '').trim();

  try {
    const decoded = jwt.verify(parsedToken, JWT_SECRET);
    const userId = decoded.userId || decoded.id || decoded._id;
    if (userId) {
      const user = await User.findById(userId).select('_id role isVerified phoneNumber phone email name').lean();
      if (user) {
        req.user = {
          id: String(user._id),
          _id: user._id,
          role: user.role || 'job_seeker',
          isVerified: Boolean(user.isVerified),
          phoneNumber: user.phoneNumber || user.phone || '',
          phone: user.phone || user.phoneNumber || '',
          email: user.email || '',
          name: user.name || '',
        };
      }
    }
  } catch (_) {
    // Silently continue for optional auth on token error
  }

  return next();
};

// ─────────────────────────────────────────────────────────────
// ROLE-BASED ACCESS CONTROL (Admin only)
// ─────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────
// SOCKET.IO AUTHENTICATION MIDDLEWARE
// ─────────────────────────────────────────────────────────────
const socketAuthMiddleware = async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(' ')[1] ||
      socket.handshake.query?.token;

    if (!token) {
      return next(new Error('Authentication token required'));
    }

    const parsedToken = String(token).replace(/^"|"$/g, '').trim();

    let decoded;
    try {
      decoded = jwt.verify(parsedToken, JWT_SECRET);
    } catch (err) {
      return next(new Error('Session invalid or expired'));
    }

    const userId = decoded.userId || decoded.id || decoded._id;
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

// ─────────────────────────────────────────────────────────────
// EXPORT COMPATIBILITY ALIASES
// ─────────────────────────────────────────────────────────────
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