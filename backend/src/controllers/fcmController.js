const User = require('../models/User');

// ─────────────────────────────────
// POST /api/notifications/fcm-token
// ─────────────────────────────────
exports.registerFcmToken = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Invalid session' });
    }

    const userId = req.user.id;
    const { token, platform = 'android', deviceId = '' } = req.body;

    if (!token || typeof token !== 'string' || token.trim().length < 10) {
      return res.status(400).json({ success: false, message: 'Invalid FCM token' });
    }

    const cleanToken = token.trim();

    // Step 1: Remove this token from ALL users (cleans duplicate records across DB)
    await User.updateMany(
      { 'fcmTokens.token': cleanToken },
      { $pull: { fcmTokens: { token: cleanToken } } }
    );

    // Step 2: Push single clean copy to current user
    await User.updateOne(
      { _id: userId },
      {
        $push: {
          fcmTokens: {
            token: cleanToken,
            platform,
            deviceId,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      }
    );

    console.log(`[FCM] ✅ Single token registered for user ${userId}`);

    return res.status(200).json({
      success: true,
      message: 'FCM token registered successfully',
    });
  } catch (error) {
    console.error('[FCM] Register error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error while registering token' });
  }
};

// ─────────────────────────────────
// POST /api/notifications/unregister-fcm
// ─────────────────────────────────
exports.removeFcmToken = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const userId = req.user.id;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, message: 'Token is required' });
    }

    await User.updateOne(
      { _id: userId },
      { $pull: { fcmTokens: { token: token.trim() } } }
    );

    console.log(`[FCM] 🧹 Token removed for user ${userId}`);
    return res.status(200).json({
      success: true,
      message: 'FCM token removed successfully',
    });
  } catch (error) {
    console.error('[FCM] Remove error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error while removing token' });
  }
};

// ─────────────────────────────────
// GET /api/notifications/fcm-tokens
// ─────────────────────────────────
exports.listFcmTokens = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const user = await User.findById(req.user.id).select('fcmTokens');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    return res.status(200).json({
      success: true,
      count: user.fcmTokens.length,
      tokens: user.fcmTokens,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};