const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { initFirebaseAdmin } = require('./config/firebaseAdmin');
const { startNotificationWatcher } = require('./services/notificationWatcher');

const app = express();

app.set('trust proxy', 1);
initFirebaseAdmin();
startNotificationWatcher();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression({ level: 6, threshold: 1024 }));
app.use(cors({ origin: true, credentials: true }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomBytes(8).toString('hex');
  res.setHeader('X-Request-Id', req.id);
  next();
});

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  message: { success: false, message: 'Too many requests, please slow down.' },
});
app.use('/api/', globalLimiter);

// ─────────────────────────────────────────────
// HEALTH
// ─────────────────────────────────────────────
app.get('/health', (req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime() }));

// ─────────────────────────────────────────────
// ROUTES & ALIASES
// ─────────────────────────────────────────────
const authRoutes = require('./routes/authRoutes');
const profileRoutes = require('./routes/profileRoutes');
const homeRoutes = require('./routes/homeRoutes');
const jobRoutes = require('./routes/jobRoutes');
const bannerRoutes = require('./routes/bannerRoutes');
const applicationRoutes = require('./routes/applicationRoutes');
const locationRoutes = require('./routes/locationRoutes');
const fcmRoutes = require('./routes/fcmRoutes');
const internalNotificationRoutes = require('./routes/internalNotificationRoutes');

// Auth & Profile (Both /api/ and root paths supported)
app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/profile', profileRoutes);

// SDUI & Jobs
app.use('/api/v1', homeRoutes);
app.use('/api/v1/jobs', jobRoutes);
app.use('/jobs', jobRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/v1/banners', bannerRoutes);

// Applications & Locations
app.use('/api/v1/applications', applicationRoutes);
app.use('/api/v1/locations', locationRoutes);
app.use('/locations', locationRoutes);

// Notifications
app.use('/api/users', fcmRoutes);
app.use('/api/v1/notifications', internalNotificationRoutes);

app.get('/', (req, res) => {
  res.json({ service: 'CareerFlow API', status: 'Running', version: '2.0.0' });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found', path: req.originalUrl });
});

app.use((err, req, res, next) => {
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

module.exports = app;