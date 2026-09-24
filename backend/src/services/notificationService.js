const { getMessaging } = require('firebase-admin/messaging');
const { initFirebaseAdmin } = require('../config/firebaseAdmin');
const User = require('../models/User');
const { mapType } = require('./notificationTypeMap');

/**
 * Sends FCM notifications to tokens with full Android compatibility.
 */
async function sendToTokens(tokens, notification, data = {}) {
  const app = initFirebaseAdmin();
  if (!app) {
    console.error('[FCM] Firebase Admin not initialized.');
    return { success: false, message: 'Firebase Admin not initialized', successCount: 0, failureCount: 0 };
  }

  const messaging = getMessaging(app);

  const tokenArray = Array.isArray(tokens) ? tokens : [tokens];
  if (!tokenArray.length) {
    return { success: false, message: 'No tokens provided', successCount: 0, failureCount: 0 };
  }

  // Ensure all data values are stringified for FCM
  const stringifiedData = {};
  Object.keys(data || {}).forEach((key) => {
    stringifiedData[key] = String(data[key] ?? '');
  });

  const messagePayload = {
    notification: {
      title: notification.title || 'CareerFlow',
      body: notification.body || '',
      ...(notification.imageUrl ? { imageUrl: notification.imageUrl } : {}),
    },
    data: stringifiedData,
    android: {
      priority: 'high',
      ttl: 60 * 60 * 24 * 1000, // 24 hours
      notification: {
        channelId: 'default',
        sound: 'default',
        priority: 'max',
        visibility: 'public',
        defaultSound: true,
        defaultVibrateTimings: true,
        ...(notification.imageUrl ? { imageUrl: notification.imageUrl } : {}),
      },
    },
  };

  try {
    const CHUNK_SIZE = 500;
    let totalSuccess = 0;
    let totalFailure = 0;
    const invalidTokens = [];

    for (let i = 0; i < tokenArray.length; i += CHUNK_SIZE) {
      const chunk = tokenArray.slice(i, i + CHUNK_SIZE);
      const response = await messaging.sendEachForMulticast({
        ...messagePayload,
        tokens: chunk,
      });

      totalSuccess += response.successCount;
      totalFailure += response.failureCount;

      response.responses.forEach((res, idx) => {
        if (!res.success) {
          const errorCode = res.error?.code || '';
          console.log(`[FCM] Token delivery failure: ${errorCode}`, res.error?.message);
          if (
            errorCode === 'messaging/invalid-registration-token' ||
            errorCode === 'messaging/registration-token-not-registered'
          ) {
            invalidTokens.push(chunk[idx]);
          }
        }
      });
    }

    // Clean up stale tokens
    if (invalidTokens.length) {
      await User.updateMany(
        { 'fcmTokens.token': { $in: invalidTokens } },
        { $pull: { fcmTokens: { token: { $in: invalidTokens } } } }
      );
      console.log(`[FCM] 🧹 Cleaned ${invalidTokens.length} expired tokens`);
    }

    return {
      success: totalSuccess > 0,
      successCount: totalSuccess,
      failureCount: totalFailure,
      invalidTokensRemoved: invalidTokens.length,
    };
  } catch (err) {
    console.error('[FCM] Send error:', err.message);
    return { success: false, message: err.message, successCount: 0, failureCount: 0 };
  }
}

/**
 * Resolves audience filters matching admin panel criteria.
 */
async function resolveTargetUsers(notificationDoc) {
  const { targetAudience, targetUserIds = [], targetCity, targetRole, filters = {} } = notificationDoc;

  let query = { 'fcmTokens.0': { $exists: true } };

  switch ((targetAudience || 'all').toLowerCase()) {
    case 'all':
      break;

    case 'candidates':
    case 'candidate':
    case 'job_seeker':
    case 'job_seekers':
      query.role = 'job_seeker';
      break;

    case 'recruiters':
    case 'recruiter':
      query.role = 'recruiter';
      break;

    case 'specific':
      if (targetUserIds && targetUserIds.length > 0) {
        query._id = { $in: targetUserIds };
      }
      break;

    case 'city':
      if (targetCity) {
        query.city = new RegExp(`^${targetCity}$`, 'i');
      }
      break;

    case 'role':
      if (targetRole) {
        query.role = targetRole;
      }
      break;

    case 'skills':
      if (filters?.skills && filters.skills.length > 0) {
        query.skills = { $in: filters.skills };
      }
      break;

    default:
      break;
  }

  const users = await User.find(query).select('fcmTokens').lean();
  return users;
}

/**
 * Dispatches push notification directly from a MongoDB Notification doc.
 */
async function pushForNotification(notificationDoc) {
  const users = await resolveTargetUsers(notificationDoc);
  const tokens = [];
  users.forEach((u) => {
    u.fcmTokens?.forEach((t) => {
      if (t.token) tokens.push(t.token);
    });
  });

  if (!tokens.length) {
    console.log('[FCM] ⚠️ No registered user tokens found for targeted audience:', notificationDoc.targetAudience);
    return {
      success: false,
      message: 'No registered user devices found for targeted audience',
      successCount: 0,
      failureCount: 0,
    };
  }

  const mobileType = mapType(notificationDoc.type);

  const dataPayload = {
    type: mobileType,
    notificationId: String(notificationDoc._id),
    title: String(notificationDoc.title || ''),
    body: String(notificationDoc.body || ''),
    ...(notificationDoc.data || {}),
  };

  return sendToTokens(
    tokens,
    {
      title: notificationDoc.title,
      body: notificationDoc.body,
      imageUrl: notificationDoc.imageUrl || '',
    },
    dataPayload
  );
}

module.exports = {
  sendToTokens,
  resolveTargetUsers,
  pushForNotification,
};