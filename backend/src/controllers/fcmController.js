const User = require('../models/User');

// ─────────────────────────────────
// POST /api/notifications/fcm-token
// Register or update the current device's FCM token
// ─────────────────────────────────
exports.registerFcmToken = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Invalid session' });
    }

    const userId = req.user.id;
    const { token, platform = 'android', deviceId = '' } = req.body;

    if (!token || typeof token !== 'string' || token.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Invalid FCM token',
      });
    }

    if (!['android', 'ios', 'web'].includes(platform)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid platform',
      });
    }

    const cleanToken = token.trim();

    // Step 1: Remove this token from ALL other users (device switching accounts)
    await User.updateMany(
      { _id: { $ne: userId }, 'fcmTokens.token': cleanToken },
      { $pull: { fcmTokens: { token: cleanToken } } }
    );

    // Step 2: Update or push for current user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!Array.isArray(user.fcmTokens)) {
      user.fcmTokens = [];
    }

    const existingIndex = user.fcmTokens.findIndex((t) => t.token === cleanToken);

    if (existingIndex >= 0) {
      user.fcmTokens[existingIndex].updatedAt = new Date();
      user.fcmTokens[existingIndex].platform = platform;
      if (deviceId) user.fcmTokens[existingIndex].deviceId = deviceId;
    } else {
      user.fcmTokens.push({
        token: cleanToken,
        platform,
        deviceId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await user.save();
    console.log(`[FCM] ✅ Token registered for user ${userId} (${platform})`);

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
      return res.status(401).json({ success: false, message: 'Unauthorized: Invalid session' });
    }

    const userId = req.user.id;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required',
      });
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
// GET /api/notifications/fcm-tokens (DEBUG)
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
    console.error('[FCM] List error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error while listing tokens' });
  }
};