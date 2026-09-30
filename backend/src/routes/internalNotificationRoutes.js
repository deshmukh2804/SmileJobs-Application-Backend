const express = require('express');
const router = express.Router();

// ✅ FIXED: Point this to the correct controller
const {
  dispatchNotification,
} = require('../controllers/internalNotificationController');

// POST /api/v1/internal/notifications/dispatch
// Notice: We don't use 'protect' here because internal routes use the 'x-internal-key' header
router.post('/dispatch', dispatchNotification);

module.exports = router;