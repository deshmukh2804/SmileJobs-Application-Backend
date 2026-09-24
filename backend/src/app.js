const express = require('express');
const cors = require('cors');
const { initFirebaseAdmin } = require('./config/firebaseAdmin');
const { startNotificationWatcher } = require('./services/notificationWatcher');

const app = express();

// ✅ Initialize Firebase Admin SDK once at startup
initFirebaseAdmin();

// ✅ Start MongoDB change-stream watcher to auto-dispatch push notifications
startNotificationWatcher();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

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

// ✅ FCM Push Notifications
app.use('/api/users', require('./routes/fcmRoutes'));

// ✅ Internal Notifications (admin-created)
app.use('/api/v1/notifications', require('./routes/internalNotificationRoutes'));

app.get('/', (req, res) => {
  res.json({
    service: 'CareerFlow API',
    status: 'Running',
    version: '1.4.0',
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
        backfill: 'GET  /api/v1/jobs/backfill-coords',
      },
      applications: {
        apply: 'POST   /api/v1/applications',
        myApps: 'GET    /api/v1/applications/my',
        check: 'GET    /api/v1/applications/check/:jobId',
        debug: 'GET    /api/v1/applications/debug',
        withdraw: 'DELETE /api/v1/applications/:id',
      },
      locations: {
        search: 'GET /api/v1/locations/search?q=xxx',
        getMe: 'GET /api/v1/locations/me',
        updateMe: 'PUT /api/v1/locations/me',
      },
      notifications: {
        registerToken: 'POST   /api/users/fcm-token',
        removeToken: 'DELETE /api/users/fcm-token',
        listTokens: 'GET    /api/users/fcm-tokens',
      },
    },
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error('SERVER ERROR:', err.message);
  res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
});

module.exports = app;