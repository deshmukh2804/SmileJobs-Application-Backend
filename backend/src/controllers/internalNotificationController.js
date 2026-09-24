const Notification = require('../models/Notification');
const { processNotification } = require('../services/notificationWatcher');
const { pushForNotification } = require('../services/notificationService');

// POST /api/v1/internal/notifications/dispatch
exports.dispatchNotification = async (req, res) => {
  try {
    const apiKey = req.headers['x-internal-key'];
    const expectedKey = process.env.INTERNAL_API_SECRET || 'careerflow_internal_secret_2026';

    if (apiKey !== expectedKey) {
      return res.status(401).json({ success: false, message: 'Unauthorized internal request' });
    }

    const { notificationId, notificationDoc } = req.body;

    let targetDoc = null;

    if (notificationId) {
      targetDoc = await Notification.findById(notificationId);
    } else if (notificationDoc) {
      targetDoc = notificationDoc;
    }

    if (!targetDoc) {
      return res.status(400).json({ success: false, message: 'Valid notificationId or notificationDoc required' });
    }

    const result = await pushForNotification(targetDoc);

    if (notificationId) {
      await Notification.updateOne(
        { _id: notificationId },
        {
          $set: {
            pushProcessed: true,
            'stats.pushSent': result.successCount || 0,
            'stats.pushFailed': result.failureCount || 0,
          },
        }
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Notification dispatched via FCM',
      stats: result,
    });
  } catch (error) {
    console.error('[Internal Dispatch] Error:', error.message);
    return res.status(500).json({ success: false, message: error.message });
  }
};