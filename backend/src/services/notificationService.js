const { getMessaging } = require('firebase-admin/messaging');
const { initFirebaseAdmin } = require('../config/firebaseAdmin');
const User = require('../models/User');
const { mapType } = require('./notificationTypeMap');

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

function buildJobNotificationTemplate(doc, userName = '') {
  const d = doc.data || {};

  const hrName = safeString(d.hrName || 'HR');
  const jobRole = safeString(d.jobRole || d.title || doc.title);
  const salary = safeString(d.salary || d.salaryRange);
  const location = safeString(d.location || d.subLocation);
  const city = safeString(d.city || doc.targetCity);
  const company = safeString(d.company || d.companyName);

  let title = safeString(doc.title);
  if (!title) {
    title = userName
      ? `${userName}, ${hrName} already reviewed your profile.`
      : company
        ? `New opening at ${company}! 🔥`
        : `${hrName} already reviewed your profile.`;
  }

  let body = safeString(doc.body);
  if (!body) {
    const parts = [];
    if (jobRole) parts.push(jobRole);
    if (salary) parts.push(`Salary : ${salary}`);
    if (location) parts.push(`Location : ${location}`);
    if (city) parts.push(`City : ${city}`);
    parts.push('');
    parts.push('VIEW DETAILS');
    body = parts.join('\n');
  }

  return { title, body };
}

function buildPushNotificationTemplate(doc, userName = '') {
  const title =
    safeString(doc.title) ||
    (userName ? `Hello ${userName}, new update available 📬` : 'New update available 📬');
  const body = safeString(doc.body) || 'Tap to view details.';
  return { title, body };
}

function buildTemplate(doc, userName = '') {
  const type = String(doc.type || '').toLowerCase().trim();
  const JOB_TYPES = ['job_alert', 'new_job', 'job', 'job_opening', 'job_post', 'profile_review'];
  if (JOB_TYPES.includes(type)) {
    return buildJobNotificationTemplate(doc, userName);
  }
  return buildPushNotificationTemplate(doc, userName);
}

async function sendToTokens(tokens, notification, data = {}) {
  const app = initFirebaseAdmin();
  if (!app) {
    console.error('[FCM] Firebase Admin not initialized.');
    return { success: false, message: 'Firebase Admin not initialized', successCount: 0, failureCount: 0 };
  }

  const messaging = getMessaging(app);
  const tokenArray = (Array.isArray(tokens) ? tokens : [tokens]).filter(Boolean);

  if (!tokenArray.length) {
    return { success: false, message: 'No tokens', successCount: 0, failureCount: 0 };
  }

  const stringifiedData = {};
  Object.keys(data || {}).forEach((key) => {
    stringifiedData[key] = String(data[key] ?? '');
  });

  // Ensure title/body also in data (helps some Android OEMs + cold start)
  stringifiedData.title = String(notification.title || '');
  stringifiedData.body = String(notification.body || '');

  const messagePayload = {
    notification: {
      title: notification.title || 'SmileJobs',
      body: notification.body || '',
      ...(notification.imageUrl ? { imageUrl: notification.imageUrl } : {}),
    },
    data: stringifiedData,
    android: {
      priority: 'high',
      ttl: 60 * 60 * 24 * 1000,
      notification: {
        channelId: 'default',
        sound: 'default',
        priority: 'max',
        visibility: 'public',
        defaultSound: true,
        defaultVibrateTimings: true,
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        ...(notification.imageUrl ? { imageUrl: notification.imageUrl } : {}),
      },
    },
    apns: {
      payload: {
        aps: {
          alert: {
            title: notification.title || 'SmileJobs',
            body: notification.body || '',
          },
          sound: 'default',
          contentAvailable: true,
        },
      },
    },
  };

  try {
    const CHUNK_SIZE = 500;
    let totalSuccess = 0;
    let totalFailure = 0;
    const invalidTokens = [];

    console.log(`[FCM] 📤 Sending to ${tokenArray.length} token(s)...`);
    console.log(`[FCM] Title: ${messagePayload.notification.title}`);
    console.log(`[FCM] Body: ${messagePayload.notification.body?.substring(0, 80)}...`);

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
          console.log(`[FCM] ❌ Token fail: ${errorCode} | ${res.error?.message}`);
          if (
            errorCode === 'messaging/invalid-registration-token' ||
            errorCode === 'messaging/registration-token-not-registered'
          ) {
            invalidTokens.push(chunk[idx]);
          }
        } else {
          console.log(`[FCM] ✅ Delivered messageId: ${res.messageId}`);
        }
      });
    }

    if (invalidTokens.length) {
      await User.updateMany(
        { 'fcmTokens.token': { $in: invalidTokens } },
        { $pull: { fcmTokens: { token: { $in: invalidTokens } } } }
      );
      console.log(`[FCM] 🧹 Cleaned ${invalidTokens.length} expired tokens`);
    }

    console.log(`[FCM] Done → success=${totalSuccess} fail=${totalFailure}`);

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

async function resolveTargetUsers(notificationDoc) {
  const {
    targetAudience,
    targetUserIds = [],
    targetCity,
    targetRole,
    filters = {},
  } = notificationDoc;

  // Must have at least one FCM token
  let query = { 'fcmTokens.0': { $exists: true } };

  const audience = (targetAudience || 'all').toLowerCase();

  switch (audience) {
    case 'all':
      break;

    case 'candidates':
    case 'candidate':
    case 'job_seeker':
    case 'job_seekers':
      // Support multiple role naming conventions in DB
      query.role = { $in: ['job_seeker', 'candidate', 'user', 'seeker'] };
      break;

    case 'recruiters':
    case 'recruiter':
      query.role = { $in: ['recruiter', 'employer', 'hr'] };
      break;

    case 'specific':
      if (targetUserIds?.length > 0) {
        query._id = { $in: targetUserIds };
      }
      break;

    case 'city':
      if (targetCity) {
        query.$or = [
          { city: new RegExp(`^${targetCity}$`, 'i') },
          { 'location.city': new RegExp(`^${targetCity}$`, 'i') },
        ];
      }
      break;

    case 'role':
      if (targetRole) {
        const role = String(targetRole).toLowerCase();
        if (['job_seeker', 'candidate', 'seeker', 'user'].includes(role)) {
          query.role = { $in: ['job_seeker', 'candidate', 'user', 'seeker'] };
        } else {
          query.role = targetRole;
        }
      }
      break;

    case 'skills':
      if (filters?.skills?.length > 0) {
        query.skills = { $in: filters.skills };
      }
      break;

    default:
      break;
  }

  const users = await User.find(query).select('fcmTokens name role city').lean();
  console.log(`[FCM] 🎯 Audience="${audience}" matched ${users.length} user(s) with tokens`);
  if (users.length === 0) {
    console.log(`[FCM] ⚠️ Query was:`, JSON.stringify(query));
  }
  return users;
}

async function pushForNotification(notificationDoc) {
  const users = await resolveTargetUsers(notificationDoc);

  if (!users.length) {
    console.log('[FCM] ⚠️ No targeted users found with active tokens.');
    return {
      success: false,
      message: 'No registered user devices found for targeted audience',
      successCount: 0,
      failureCount: 0,
    };
  }

  const mobileType = mapType(notificationDoc.type);
  const isBulkSend = users.length > 2000;

  let successCount = 0;
  let failureCount = 0;
  let invalidTokensRemoved = 0;

  // Personalized (or normal) path
  if (!isBulkSend) {
    console.log(`[FCM] Dispatching to ${users.length} users...`);

    for (const u of users) {
      const tokens = (u.fcmTokens || []).map((t) => t.token).filter(Boolean);
      if (!tokens.length) continue;

      const { title, body } = buildTemplate(notificationDoc, u.name || '');

      const globalDataPayload = {
        type: mobileType,
        notificationId: String(notificationDoc._id || ''),
        title,
        body,
        jobId: String(notificationDoc.data?.jobId || ''),
        ...(notificationDoc.data || {}),
      };

      const res = await sendToTokens(
        tokens,
        { title, body, imageUrl: notificationDoc.imageUrl || '' },
        globalDataPayload
      );

      successCount += res.successCount || 0;
      failureCount += res.failureCount || 0;
      invalidTokensRemoved += res.invalidTokensRemoved || 0;
    }

    return { success: successCount > 0, successCount, failureCount, invalidTokensRemoved };
  }

  // Bulk path
  console.log(`[FCM] Bulk multicast to ${users.length} recipients...`);
  const { title, body } = buildTemplate(notificationDoc, '');
  const allTokens = users.flatMap((u) => (u.fcmTokens || []).map((t) => t.token).filter(Boolean));

  const globalDataPayload = {
    type: mobileType,
    notificationId: String(notificationDoc._id || ''),
    title,
    body,
    jobId: String(notificationDoc.data?.jobId || ''),
    ...(notificationDoc.data || {}),
  };

  return sendToTokens(
    allTokens,
    { title, body, imageUrl: notificationDoc.imageUrl || '' },
    globalDataPayload
  );
}

module.exports = {
  sendToTokens,
  resolveTargetUsers,
  pushForNotification,
  buildJobNotificationTemplate,
  buildPushNotificationTemplate,
  buildTemplate,
};