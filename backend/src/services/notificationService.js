const { getMessaging } = require('firebase-admin/messaging');
const { initFirebaseAdmin } = require('../config/firebaseAdmin');
const User = require('../models/User');
const { mapType } = require('./notificationTypeMap');

// ─────────────────────────────────────────────
// ✅ Sanitize objects and prevent [object Object] leaks
// ─────────────────────────────────────────────
function safeString(val) {
  if (!val) return '';
  if (typeof val === 'string') {
    if (val.includes('[object Object]')) return '';
    return val;
  }
  if (typeof val === 'object') {
    return val.display || val.city || val.subLocation || val.name || '';
  }
  return String(val);
}

// ─────────────────────────────────────────────
// 📋 TEMPLATE 1 — MULTI-LINE JOB NOTIFICATION (Matches Image)
// ─────────────────────────────────────────────
function buildJobNotificationTemplate(doc, userName = '') {
  const d = doc.data || {};

  // Get data dynamically from Admin panel data object
  const hrName   = safeString(d.hrName || 'HR');
  const jobRole  = safeString(d.jobRole || d.title || doc.title);
  const salary   = safeString(d.salary || d.salaryRange);
  const location = safeString(d.location || d.subLocation);
  const city     = safeString(d.city || doc.targetCity);

  // ── Title ──
  // If admin provided a strict title, use it. Otherwise, generate like the image.
  let title = doc.title;
  if (!title || title.trim() === '') {
    title = userName 
      ? `${userName}, ${hrName} already reviewed your profile.`
      : `${hrName} already reviewed your profile.`;
  }

  // ── Body (Using \n to create the multi-line list format) ──
  // If admin provided a strict body text, use it. Otherwise, build it dynamically.
  let body = doc.body;
  if (!body || body.trim() === '') {
    const parts = [];
    if (jobRole)  parts.push(`${jobRole}`);
    if (salary)   parts.push(`Salary : ${salary}`);
    if (location) parts.push(`Location : ${location}`);
    if (city)     parts.push(`City : ${city}`);
    
    parts.push(''); // Creates an empty line
    parts.push('VIEW DETAILS');
    
    body = parts.join('\n'); // Joins array with newlines for multi-line notification
  }

  return { title, body };
}

// ─────────────────────────────────────────────
// 📋 TEMPLATE 2 — GENERAL PUSH NOTIFICATION
// ─────────────────────────────────────────────
function buildPushNotificationTemplate(doc, userName = '') {
  const d = doc.data || {};

  let title = doc.title || (userName ? `Hello ${userName}, new update available 📬` : 'New update available 📬');
  let body = doc.body || 'Tap to view details.';

  return { title, body };
}

// ─────────────────────────────────────────────
// 🔀 TEMPLATE ROUTER
// ─────────────────────────────────────────────
function buildTemplate(doc, userName = '') {
  const type = String(doc.type || '').toLowerCase().trim();
  const JOB_TYPES = ['job_alert', 'new_job', 'job', 'job_opening', 'job_post', 'profile_review'];

  if (JOB_TYPES.includes(type)) {
    return buildJobNotificationTemplate(doc, userName);
  }

  return buildPushNotificationTemplate(doc, userName);
}

/**
 * Sends FCM notifications to tokens.
 */
async function sendToTokens(tokens, notification, data = {}) {
  const app = initFirebaseAdmin();
  if (!app) {
    console.error('[FCM] Firebase Admin not initialized.');
    return { success: false, message: 'Firebase Admin not initialized', successCount: 0, failureCount: 0 };
  }

  const messaging = getMessaging(app);
  const tokenArray = Array.isArray(tokens) ? tokens : [tokens];
  if (!tokenArray.length) return { success: false, message: 'No tokens', successCount: 0, failureCount: 0 };

  const stringifiedData = {};
  Object.keys(data || {}).forEach((key) => {
    stringifiedData[key] = String(data[key] ?? '');
  });

  const messagePayload = {
    notification: {
      title: notification.title,
      body: notification.body,
      // If admin uploads an image URL, it will show on the right side of the notification
      ...(notification.imageUrl ? { imageUrl: notification.imageUrl } : {}), 
    },
    data: stringifiedData,
    android: {
      priority: 'high',
      notification: {
        channelId: 'default',
        style: 'bigtext', // Crucial for multi-line \n rendering on Android
        priority: 'max',
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
          if (errorCode === 'messaging/invalid-registration-token' || errorCode === 'messaging/registration-token-not-registered') {
            invalidTokens.push(chunk[idx]);
          }
        }
      });
    }

    if (invalidTokens.length) {
      await User.updateMany(
        { 'fcmTokens.token': { $in: invalidTokens } },
        { $pull: { fcmTokens: { token: { $in: invalidTokens } } } }
      );
    }

    return { success: totalSuccess > 0, successCount: totalSuccess, failureCount: totalFailure };
  } catch (err) {
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
    case 'candidates': query.role = 'job_seeker'; break;
    case 'recruiters': query.role = 'recruiter'; break;
    case 'specific': if (targetUserIds.length) query._id = { $in: targetUserIds }; break;
    case 'city': if (targetCity) query.city = new RegExp(`^${targetCity}$`, 'i'); break;
    case 'role': if (targetRole) query.role = targetRole; break;
    case 'skills': if (filters?.skills?.length) query.skills = { $in: filters.skills }; break;
  }

  // NOTE: Added 'name' to the select query so we can personalize the notification title
  return await User.find(query).select('fcmTokens name').lean();
}

/**
 * Dispatches push notification from a MongoDB Notification doc.
 */
async function pushForNotification(notificationDoc) {
  const users = await resolveTargetUsers(notificationDoc);
  if (!users.length) return { success: false, message: 'No registered user devices found' };

  const mobileType = mapType(notificationDoc.type);
  const isBulkSend = users.length > 2000;

  let successCount = 0;
  let failureCount = 0;

  // ── INDIVIDUAL DISPATCH (Allows Personalized Names like "Mayank,...") ──
  if (!isBulkSend || notificationDoc.title === "") {
    for (const u of users) {
      const tokens = (u.fcmTokens || []).map(t => t.token).filter(Boolean);
      if (!tokens.length) continue;

      // Pass user's name to template builder
      const { title, body } = buildTemplate(notificationDoc, u.name);

      const globalDataPayload = {
        type: mobileType,
        notificationId: String(notificationDoc._id),
        title,
        body,
        ...(notificationDoc.data || {}),
      };

      const res = await sendToTokens(tokens, { title, body, imageUrl: notificationDoc.imageUrl }, globalDataPayload);
      successCount += res.successCount || 0;
      failureCount += res.failureCount || 0;
    }
    return { success: successCount > 0, successCount, failureCount };
  }

  // ── MULTICAST DISPATCH (For massive bulk sends without names to save performance) ──
  const { title, body } = buildTemplate(notificationDoc, ''); // No specific name
  const allTokens = users.flatMap(u => (u.fcmTokens || []).map(t => t.token).filter(Boolean));

  const globalDataPayload = {
    type: mobileType,
    notificationId: String(notificationDoc._id),
    title,
    body,
    ...(notificationDoc.data || {}),
  };

  return sendToTokens(allTokens, { title, body, imageUrl: notificationDoc.imageUrl }, globalDataPayload);
}

module.exports = {
  sendToTokens,
  resolveTargetUsers,
  pushForNotification,
  buildJobNotificationTemplate,
  buildTemplate,
};