const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { initFirebaseAdmin } = require('./config/firebaseAdmin');
const { startNotificationWatcher } = require('./services/notificationWatcher');

const app = express();

// ✅ Trust proxy — CRITICAL for Render (correct client IP for rate limiting)
app.set('trust proxy', 1);

// ✅ Initialize Firebase Admin SDK once at startup
initFirebaseAdmin();

// ✅ Start MongoDB change-stream watcher to auto-dispatch push notifications
startNotificationWatcher();

// ─────────────────────────────────────────────────────────────
// SECURITY & PERFORMANCE MIDDLEWARE
// ─────────────────────────────────────────────────────────────

// Security headers (safe defaults for JSON APIs)
app.use(helmet({
  contentSecurityPolicy: false,      // Not needed for JSON API
  crossOriginEmbedderPolicy: false,  // Allow mobile app requests
}));

// HTTP compression (gzip) — reduces JSON payload size 60-80%
app.use(compression({
  level: 6,
  threshold: 1024,  // Only compress responses > 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));

// CORS — production-safe
app.use(cors({
  origin: true,  // Allow all origins (mobile app doesn't send Origin header)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─────────────────────────────────────────────────────────────
// REQUEST ID + STRUCTURED LOGGING
// ─────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  req._startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - req._startTime;
    // Only log slow requests, errors, and non-GET methods to reduce noise
    if (duration > 500 || res.statusCode >= 400 || req.method !== 'GET') {
      console.log(
        `[${req.id}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`
      );
    }
  });
  next();
});

// ─────────────────────────────────────────────────────────────
// RATE LIMITING — protect against abuse
// ─────────────────────────────────────────────────────────────

// Global limiter (generous — protects against total abuse)
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,     // 1 minute
  max: 300,                // 300 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please slow down.' },
});

// Strict limiter for auth endpoints (prevent brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 20,                    // 20 auth attempts per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many auth attempts, try again later.' },
});

app.use('/api/', globalLimiter);
app.use('/api/auth/', authLimiter);

// ─────────────────────────────────────────────────────────────
// HEALTH ENDPOINTS (for Render monitoring — no auth, no DB call)
// ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/health/ready', async (req, res) => {
  const mongoose = require('mongoose');
  const dbState = mongoose.connection.readyState;
  const states = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  const ready = dbState === 1;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not-ready',
    db: states[dbState] || 'unknown',
    timestamp: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────

// Auth & Profile
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/profile', require('./routes/profileRoutes'));

// SDUI + Data
app.use('/api/v1', require('./routes/homeRoutes'));
app.use('/api/v1/jobs', require('./routes/jobRoutes'));
app.use('/api/v1/banners', require('./routes/bannerRoutes'));

// Applications
app.use('/api/v1/applications', require('./routes/applicationRoutes'));

// Locations
app.use('/api/v1/locations', require('./routes/locationRoutes'));

// FCM Push Notifications
app.use('/api/users', require('./routes/fcmRoutes'));

// Internal Notifications (admin-created)
app.use('/api/v1/notifications', require('./routes/internalNotificationRoutes'));

// ─────────────────────────────────────────────────────────────
// ROOT / API INFO
// ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    service: 'CareerFlow API',
    status: 'Running',
    version: '2.0.0',
    health: '/health',
    endpoints: {
      auth: {
        sendOTP: 'POST /api/auth/send-otp',
        verifyOTP: 'POST /api/auth/verify-otp',
        google: 'POST /api/auth/google',
        profile: 'GET  /api/auth/profile',
      },
      profile: {
        getMe: 'GET  /api/profile/me',
        updateMe: 'PUT  /api/profile/me',
        uploadResume: 'POST /api/profile/upload-resume',
        uploadAvatar: 'POST /api/profile/upload-avatar',
      },
      jobs: {
        list: 'GET  /api/v1/jobs',
        search: 'GET  /api/v1/jobs/search?q=xxx',
        nearby: 'GET  /api/v1/jobs/nearby?lat=&lon=&radius=50',
        other: 'GET  /api/v1/jobs/other?lat=&lon=',
        byId: 'GET  /api/v1/jobs/:id',
      },
      applications: {
        apply: 'POST   /api/v1/applications',
        myApps: 'GET    /api/v1/applications/my',
        check: 'GET    /api/v1/applications/check/:jobId',
        withdraw: 'DELETE /api/v1/applications/:id',
      },
      locations: {
        search: 'GET /api/v1/locations/search?q=xxx',
        cities: 'GET /api/v1/locations/cities',
        areas: 'GET /api/v1/locations/cities/:cityName/areas',
        getMe: 'GET /api/v1/locations/me',
        updateMe: 'PUT /api/v1/locations/me',
      },
      notifications: {
        registerToken: 'POST   /api/users/fcm-token',
        removeToken: 'DELETE /api/users/fcm-token',
      },
    },
  });
});

// ─────────────────────────────────────────────────────────────
// 404 HANDLER
// ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl,
    requestId: req.id,
  });
});

// ─────────────────────────────────────────────────────────────
// GLOBAL ERROR HANDLER (structured, safe)
// ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';

  console.error(`[${req.id}] SERVER ERROR:`, {
    method: req.method,
    url: req.originalUrl,
    status,
    message: err.message,
    stack: isProd ? undefined : err.stack,
  });

  res.status(status).json({
    success: false,
    message: err.message || 'Internal Server Error',
    code: err.code || 'INTERNAL_ERROR',
    requestId: req.id,
  });
});

module.exports = app;