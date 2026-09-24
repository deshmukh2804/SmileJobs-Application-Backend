const express = require('express');
const router = express.Router();
const { dispatchNotification } = require('../controllers/internalNotificationController');

router.post('/dispatch', dispatchNotification);

module.exports = router;