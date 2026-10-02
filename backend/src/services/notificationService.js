const { getMessaging } = require('firebase-admin/messaging');
const { initFirebaseAdmin } = require('../config/firebaseAdmin');
const User = require('../models/User');
const { mapType } = require('./notificationTypeMap');

// ═══════════════════════════════════════════════════════════════
// SAFE STRING EXTRACTOR — Handles nested objects, arrays, nulls
// Prevents [object Object] from appearing in notifications
// ═══════════════════════════════════════════════════════════════
function safeString(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed || trimmed === '[object Object]' || trimmed.includes('[object Object]')) return '';
    return trimmed;
  }
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return '';
  if (Array.isArray(val)) {
    return val.map(safeString).filter(Boolean).join(', ');
  }
  if (typeof val === 'object') {
    // Try common display fields in priority order
    const candidates = [
      val.display, val.name, val.text, val.label, val.title,
      val.city, val.subLocation, val.area, val.address,
      val.value,
    ];
    for (const c of candidates) {
      const s = safeString(c);
      if (s) return s;
    }
    return '';
  }
  return String(val);
}

// ═══════════════════════════════════════════════════════════════
// SALARY FORMATTER — Converts salary object → "Rs. 20000 - Rs. 25000"
// ═══════════════════════════════════════════════════════════════
function formatSalary(salary) {
  if (!salary) return '';
  if (typeof salary === 'string') return safeString(salary);
  if (typeof salary === 'object') {
    const min = salary.min != null ? Number(salary.min) : null;
    const max = salary.max != null ? Number(salary.max) : null;
    const currency = salary.currency || 'INR';
    const symbol = currency === 'INR' ? 'Rs.' : currency;

    if (min && max && min !== max) return `${symbol} ${min} - ${symbol} ${max}`;
    if (min && max && min === max) return `${symbol} ${min}`;
    if (min) return `${symbol} ${min}+`;
    if (max) return `Up to ${symbol} ${max}`;
  }
  return '';
}

// ═══════════════════════════════════════════════════════════════
// LOCATION EXTRACTOR — Pulls area/sub-location (not city)
// ═══════════════════════════════════════════════════════════════
function extractLocationArea(location) {
  if (!location) return '';
  if (typeof location === 'string') return safeString(location);
  if (typeof location === 'object') {
    // Prefer sub-location/area/address over city
    return safeString(location.subLocation) ||
           safeString(location.area) ||
           safeString(location.address) ||
           safeString(location.locality) ||
           '';
  }
  return '';
}

// ═══════════════════════════════════════════════════════════════
// CITY EXTRACTOR
// ═══════════════════════════════════════════════════════════════
function extractCity(location, fallbackCity) {
  if (location && typeof location === 'object') {
    const city = safeString(location.city);
    if (city) return city;
  }
  if (location && typeof location === 'string') {
    // If it's a string, use first comma-separated part
    const parts = location.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length) return parts[0];
  }
  return safeString(fallbackCity);
}

// ═══════════════════════════════════════════════════════════════
// JOB NOTIFICATION TEMPLATE
// Matches the image format:
//   TITLE: "Mayank, Pooja (HR) already reviewed your profile."
//   BODY:  "Back Office Employee
//           Salary : Rs. 20000 - Rs. 25000
//           Location : Ravet
//           City : pune
//           
//           VIEW DETAILS"
// ═══════════════════════════════════════════════════════════════
function buildJobNotificationTemplate(doc, userName = '') {
  const d = doc.data || {};
  const type = String(doc.type || '').toLowerCase().trim();

  // Extract fields safely
  const hrName    = safeString(d.hrName) || safeString(d.contactPerson?.name) || 'HR';
  const jobRole   = safeString(d.jobRole) || safeString(d.title) || safeString(doc.title) || safeString(d.role);
  const salary    = formatSalary(d.salary) || safeString(d.salaryRange);
  const location  = extractLocationArea(d.location) || safeString(d.subLocation) || safeString(d.area);
  const city      = extractCity(d.location, d.city || doc.targetCity);
  const company   = safeString(d.company) || safeString(d.companyName);

  // ─── TITLE ───
  let title = '';
  const docTitle = safeString(doc.title);
  const isStatusUpdate = [
    'profile_review', 'application_viewed', 'application_shortlisted',
    'application_interview', 'application_offered', 'application_hired',
    'application_rejected',
  ].includes(type);

  if (isStatusUpdate) {
    // Status change notifications → personalized
    const firstName = userName.split(' ')[0] || '';
    const statusText = getStatusTitleText(type);
    if (firstName) {
      title = `${firstName}, ${hrName} ${statusText}`;
    } else {
      title = `${hrName} ${statusText}`;
    }
  } else if (docTitle) {
    title = docTitle;
  } else if (userName) {
    const firstName = userName.split(' ')[0];
    title = company
      ? `${firstName}, new opening at ${company}! 🔥`
      : `${firstName}, a new job matches your profile!`;
  } else {
    title = company ? `New opening at ${company}! 🔥` : 'New Job Alert 🔔';
  }

  // ─── BODY (multi-line, matches image) ───
  let body = '';
  const docBody = safeString(doc.body);

  if (docBody && !docBody.includes('[object Object]')) {
    // Admin provided custom body → use as-is
    body = docBody;
  } else {
    const parts = [];
    if (jobRole)  parts.push(jobRole);
    if (salary)   parts.push(`Salary : ${salary}`);
    if (location) parts.push(`Location : ${location}`);
    if (city)     parts.push(`City : ${city}`);

    if (parts.length === 0) {
      // Fallback
      parts.push('Tap to view this exciting opportunity!');
    } else {
      parts.push(''); // blank line
      parts.push('VIEW DETAILS');
    }
    body = parts.join('\n');
  }

  return { title, body };
}

// ═══════════════════════════════════════════════════════════════
// STATUS → TITLE TEXT MAP
// ═══════════════════════════════════════════════════════════════
function getStatusTitleText(type) {
  const map = {
    profile_review:          'already reviewed your profile.',
    application_viewed:      'viewed your application.',
    application_shortlisted: 'shortlisted you for the next round! 🎉',
    application_interview:   'scheduled your interview! 📅',
    application_offered:     'extended you a job offer! 🎊',
    application_hired:       'hired you! Congratulations! 🎉',
    application_rejected:    'reviewed your application.',
  };
  return map[type] || 'has an update on your application.';
}

// ═══════════════════════════════════════════════════════════════
// GENERIC PUSH TEMPLATE (non-job notifications)
// ═══════════════════════════════════════════════════════════════
function buildPushNotificationTemplate(doc, userName = '') {
  const title = safeString(doc.title) ||
    (userName ? `Hello ${userName.split(' ')[0]}, new update available 📬` : 'New update available 📬');
  const body = safeString(doc.body) || 'Tap to view details.';
  return { title, body };
}

// ═══════════════════════════════════════════════════════════════
// TEMPLATE ROUTER
// ═══════════════════════════════════════════════════════════════
function buildTemplate(doc, userName = '') {
  const type = String(doc.type || '').toLowerCase().trim();
  const JOB_TYPES = [
    'job_alert', 'new_job', 'job', 'job_opening', 'job_post',
    'profile_review', 'application_viewed', 'application_shortlisted',
    'application_interview', 'application_offered', 'application_hired',
    'application_rejected', 'application_update',
  ];
  if (JOB_TYPES.includes(type)) {
    return buildJobNotificationTemplate(doc, userName);
  }
  return buildPushNotificationTemplate(doc, userName);
}

// ═══════════════════════════════════════════════════════════════
// SEND TO FCM TOKENS (chunked, deduplicated, auto-cleanup)
// ═══════════════════════════════════════════════════════════════
async function sendToTokens(tokens, notification, data = {}) {
  const app = initFirebaseAdmin();
  if (!app) {
    console.error('[FCM] Firebase Admin not initialized.');
    return { success: false, message: 'Firebase Admin not initialized', successCount: 0, failureCount: 0 };
  }

  const messaging = getMessaging(app);

  // 🛡️ DEDUPLICATE
  const rawArray = Array.isArray(tokens) ? tokens : [tokens];
  const tokenArray = [...new Set(rawArray.filter(Boolean))];

  if (!tokenArray.length) {
    return { success: false, message: 'No unique tokens provided', successCount: 0, failureCount: 0 };
  }

  // Stringify data (FCM requires strings)
  const stringifiedData = {};
  Object.keys(data || {}).forEach((key) => {
    const v = data[key];
    if (v === null || v === undefined) {
      stringifiedData[key] = '';
    } else if (typeof v === 'object') {
      try { stringifiedData[key] = JSON.stringify(v); }
      catch { stringifiedData[key] = ''; }
    } else {
      stringifiedData[key] = String(v);
    }
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
        // ✅ BigTextStyle — needed for multi-line body like the image
        bodyLocKey: undefined,
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
          'mutable-content': 1,
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

// ═══════════════════════════════════════════════════════════════
// RESOLVE TARGET USERS
// ═══════════════════════════════════════════════════════════════
async function resolveTargetUsers(notificationDoc) {
  const audience = String(notificationDoc.targetAudience || 'all').toLowerCase().trim();
  const targetRole = String(notificationDoc.targetRole || '').toLowerCase().trim();

  let query = { 'fcmTokens.0': { $exists: true } };

  if (audience === 'all') {
    // all users with tokens
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

// ═══════════════════════════════════════════════════════════════
// PUSH FOR NOTIFICATION DOCUMENT
// ═══════════════════════════════════════════════════════════════
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
      const tokens = [...new Set((u.fcmTokens || []).map((t) => t.token).filter(Boolean))];
      if (!tokens.length) continue;

      const { title, body } = buildTemplate(notificationDoc, u.name || '');

      const globalDataPayload = {
        type: mobileType,
        notificationId: String(notificationDoc._id || ''),
        title,
        body,
        jobId: String(notificationDoc.data?.jobId || ''),
        applicationId: String(notificationDoc.data?.applicationId || ''),
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
  const allTokens = [...new Set(users.flatMap((u) => (u.fcmTokens || []).map((t) => t.token).filter(Boolean)))];

  const globalDataPayload = {
    type: mobileType,
    notificationId: String(notificationDoc._id || ''),
    title,
    body,
    jobId: String(notificationDoc.data?.jobId || ''),
    applicationId: String(notificationDoc.data?.applicationId || ''),
    ...(notificationDoc.data || {}),
  };

  return sendToTokens(
    allTokens,
    { title, body, imageUrl: notificationDoc.imageUrl || '' },
    globalDataPayload
  );
}

// ═══════════════════════════════════════════════════════════════
// 🚀 NEW: DIRECT NOTIFICATION TO A SPECIFIC USER
// Used by application status change triggers
// ═══════════════════════════════════════════════════════════════
async function sendDirectNotificationToUser(userId, notificationData) {
  try {
    const user = await User.findById(userId).select('fcmTokens name').lean();
    if (!user) {
      console.log(`[FCM-DIRECT] User not found: ${userId}`);
      return { success: false, message: 'User not found', successCount: 0, failureCount: 0 };
    }

    const tokens = [...new Set((user.fcmTokens || []).map((t) => t.token).filter(Boolean))];
    if (!tokens.length) {
      console.log(`[FCM-DIRECT] User ${user.name} has no FCM tokens`);
      return { success: false, message: 'No FCM tokens', successCount: 0, failureCount: 0 };
    }

    const virtualDoc = {
      type: notificationData.type,
      title: notificationData.title || '',
      body: notificationData.body || '',
      data: notificationData.data || {},
      imageUrl: notificationData.imageUrl || '',
      _id: notificationData._id || '',
    };

    const { title, body } = buildTemplate(virtualDoc, user.name || '');
    const mobileType = mapType(notificationData.type);

    const globalDataPayload = {
      type: mobileType,
      notificationId: String(notificationData._id || ''),
      title,
      body,
      jobId: String(notificationData.data?.jobId || ''),
      applicationId: String(notificationData.data?.applicationId || ''),
      ...(notificationData.data || {}),
    };

    console.log(`[FCM-DIRECT] 📤 Sending "${notificationData.type}" to ${user.name}`);
    console.log(`[FCM-DIRECT] Title: "${title}"`);
    console.log(`[FCM-DIRECT] Body: "${body}"`);

    return await sendToTokens(
      tokens,
      { title, body, imageUrl: notificationData.imageUrl || '' },
      globalDataPayload
    );
  } catch (err) {
    console.error('[FCM-DIRECT] Error:', err.message);
    return { success: false, message: err.message, successCount: 0, failureCount: 0 };
  }
}

module.exports = {
  sendToTokens,
  resolveTargetUsers,
  pushForNotification,
  buildJobNotificationTemplate,
  buildPushNotificationTemplate,
  buildTemplate,
  sendDirectNotificationToUser,
  safeString,
  formatSalary,
  extractLocationArea,
  extractCity,
};