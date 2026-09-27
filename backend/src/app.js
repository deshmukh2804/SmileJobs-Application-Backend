const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// ─────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-internal-key'],
}));

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Request logger (helps debug route issues)
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.originalUrl}`);
  next();
});

// ─────────────────────────────────────────────
// ROUTE IMPORTS
// ─────────────────────────────────────────────
const authRoutes = require('./routes/authRoutes');
const profileRoutes = require('./routes/profileRoutes');
const jobRoutes = require('./routes/jobRoutes');
const homeRoutes = require('./routes/homeRoutes');
const bannerRoutes = require('./routes/bannerRoutes');
const locationRoutes = require('./routes/locationRoutes');
const applicationRoutes = require('./routes/applicationRoutes');
const searchRoutes = require('./routes/searchRoutes');
const fcmRoutes = require('./routes/fcmRoutes');
const internalNotificationRoutes = require('./routes/internalNotificationRoutes');

// ─────────────────────────────────────────────
// ROUTE MOUNTING (Order matters!)
// ─────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);           // ✅ /api/profile/notifications lives here
app.use('/api/v1/jobs', jobRoutes);               // ✅ /api/v1/jobs/:id/save & /api/v1/jobs/saved live here
app.use('/api/v1/home', homeRoutes);
app.use('/api/v1/banners', bannerRoutes);
app.use('/api/v1/locations', locationRoutes);
app.use('/api/v1/applications', applicationRoutes);
app.use('/api/v1/search', searchRoutes);
app.use('/api/v1/fcm', fcmRoutes);
app.use('/api/v1/internal/notifications', internalNotificationRoutes);

// Bottom nav (used by AndroidBottomNav.tsx)
const homeController = require('./controllers/homeController');
app.get('/api/v1/bottom-nav', homeController.getBottomNav);

// ─────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'CareerFlow API is running ✅',
    endpoints: {
      auth: '/api/auth',
      profile: '/api/profile',
      profileNotifications: '/api/profile/notifications',
      jobs: '/api/v1/jobs',
      savedJobs: '/api/v1/jobs/saved',
      saveJob: 'POST /api/v1/jobs/:id/save',
      unsaveJob: 'DELETE /api/v1/jobs/:id/save',
    },
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ success: true, status: 'ok' });
});

// ─────────────────────────────────────────────
// 404 HANDLER
// ─────────────────────────────────────────────
app.use((req, res) => {
  console.log(`❌ 404: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl,
  });
});

// ─────────────────────────────────────────────
// ERROR HANDLER
// ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

module.exports = app;