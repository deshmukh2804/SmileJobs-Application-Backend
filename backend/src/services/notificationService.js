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

  const hrName   = safeString(d.hrName || 'HR');
  const jobRole  = safeString(d.jobRole || d.title || doc.title);
  const salary   = safeString(d.salary || d.salaryRange);
  const location = safeString(d.location || d.subLocation);
  const city     = safeString(d.city || doc.targetCity);
  const company  = safeString(d.company || d.companyName);

  let title = safeString(doc.title);
  if (!title || title.trim() === '') {
    title = userName
      ? `${userName}, ${hrName} already reviewed your profile.`
      : company
        ? `New opening at ${company}! 🔥`
        : `${hrName} already reviewed your profile.`;
  }

  let body = safeString(doc.body);
  if (!body || body.trim() === '') {
    const parts = [];
    if (jobRole)  parts.push(`${jobRole}`);
    if (salary)   parts.push(`Salary : ${salary}`);
    if (location) parts.push(`Location : ${location}`);
    if (city)     parts.push(`City : ${city}`);
    parts.push('');
    parts.push('VIEW DETAILS');
    body = parts.join('\n');
  }

  return { title, body };
}

function buildPushNotificationTemplate(doc, userName = '') {
  const title = safeString(doc.title) || (userName ? `Hello ${userName}, new update available 📬` : 'New update available 📬');
  const body  = safeString(doc.body) || 'Tap to view details.';
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

  // 🛡️ DEDUPLICATE TOKENS: Guarantee array contains only unique tokens
  const rawArray = Array.isArray(tokens) ? tokens : [tokens];
  const tokenArray = [...new Set(rawArray.filter(Boolean))];

  if (!tokenArray.length) {
    return { success: false, message: 'No unique tokens provided', successCount: 0, failureCount: 0 };
  }

  const stringifiedData = {};
  Object.keys(data || {}).forEach((key) => {
    stringifiedData[key] = String(data[key] ?? '');
  });

  stringifiedData.title = String(notification.title || '');
  stringifiedData.body  = String(notification.body || '');

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
        },
      },
    },
  };

  try {
    const CHUNK_SIZE = 500;
    let totalSuccess = 0;
    let totalFailure = 0;
    const invalidTokens = [];

    console.log(`[FCM] 📤 Sending to ${tokenArray.length} UNIQUE token(s)...`);

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
          console.log(`[FCM] ❌ Token error: ${errorCode} - ${res.error?.message}`);
          if (
            errorCode === 'messaging/invalid-registration-token' ||
            errorCode === 'messaging/registration-token-not-registered'
          ) {
            invalidTokens.push(chunk[idx]);
          }
        } else {
          console.log(`[FCM] ✅ Delivered to device! Message ID: ${res.messageId}`);
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
  const audience = String(notificationDoc.targetAudience || 'all').toLowerCase().trim();
  const targetRole = String(notificationDoc.targetRole || '').toLowerCase().trim();

  let query = { 'fcmTokens.0': { $exists: true } };

  if (audience === 'all') {
    // target all
  } else if (['candidates', 'candidate', 'job_seeker', 'job_seekers'].includes(audience)) {
    query.$or = [
      { role: { $in: ['job_seeker', 'candidate', 'user', 'seeker', ''] } },
      { role: { $exists: false } },
    ];
  } else if (['recruiters', 'recruiter', 'hr'].includes(audience)) {
    query.role = { $in: ['recruiter', 'employer', 'hr'] };
  } else if (audience === 'specific') {
    if (notificationDoc.targetUserIds?.length > 0) {
      query._id = { $in: notificationDoc.targetUserIds };
    }
  } else if (audience === 'city') {
    if (notificationDoc.targetCity) {
      query.$or = [
        { city: new RegExp(`^${notificationDoc.targetCity}$`, 'i') },
        { 'location.city': new RegExp(`^${notificationDoc.targetCity}$`, 'i') },
      ];
    }
  } else if (audience === 'role') {
    if (targetRole) {
      if (['job_seeker', 'candidate', 'seeker', 'user'].includes(targetRole)) {
        query.$or = [
          { role: { $in: ['job_seeker', 'candidate', 'user', 'seeker', ''] } },
          { role: { $exists: false } },
        ];
      } else {
        query.role = new RegExp(`^${targetRole}$`, 'i');
      }
    }
  }

  const users = await User.find(query).select('fcmTokens name role city').lean();
  console.log(`[FCM Resolver] Audience: "${audience}", Targeted Devices: ${users.length} user(s)`);
  return users;
}

async function pushForNotification(notificationDoc) {
  const users = await resolveTargetUsers(notificationDoc);

  if (!users.length) {
    console.log('[FCM] ⚠️ No target users found with registered FCM tokens.');
    return {
      success: false,
      message: 'No active user devices found matching target filters',
      successCount: 0,
      failureCount: 0,
    };
  }

  const mobileType = mapType(notificationDoc.type);
  const isBulkSend = users.length > 2000;

  let successCount = 0;
  let failureCount = 0;
  let invalidTokensRemoved = 0;

  if (!isBulkSend) {
    for (const u of users) {
      // 🛡️ Deduplicate tokens per user
      const tokens = [...new Set((u.fcmTokens || []).map((t) => t.token).filter(Boolean))];
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

  const { title, body } = buildTemplate(notificationDoc, '');
  // 🛡️ Deduplicate all bulk tokens
  const allTokens = [...new Set(users.flatMap((u) => (u.fcmTokens || []).map((t) => t.token).filter(Boolean)))];

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