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
// ✅ Extract User's first name for personalization
// ─────────────────────────────────────────────
function getFirstName(fullName) {
  const name = safeString(fullName).trim();
  if (!name) return '';
  return name.split(/\s+/)[0] || '';
}

// ─────────────────────────────────────────────
// 📋 TEMPLATE 1 — NEW JOB NOTIFICATION
// Used when type = job_alert | new_job | job
// ─────────────────────────────────────────────
function buildJobNotificationTemplate(firstName, doc) {
  const d = doc.data || {};

  const jobTitle = safeString(d.title || d.jobTitle || doc.title) || 'New Opportunity';
  const company  = safeString(d.companyName || d.company);
  const location = safeString(d.location || d.city || doc.targetCity);
  const salary   = safeString(d.salary || d.currentSalary || d.salaryRange);
  const jobType  = safeString(d.workType || d.jobType || d.type);
  const deadline = safeString(d.deadline || d.applyBefore);

  // ── Title ──
  let title = '';
  if (firstName && company) {
    title = `${firstName}, new ${jobTitle} at ${company}! 🔥`;
  } else if (firstName) {
    title = `${firstName}, a new ${jobTitle} just dropped! 🔥`;
  } else if (company) {
    title = `New ${jobTitle} opening at ${company} 🔥`;
  } else {
    title = `New ${jobTitle} just posted! 🔥`;
  }

  // ── Body ──
  const parts = [];
  if (location) parts.push(`📍 ${location}`);
  if (salary)   parts.push(`💰 ${salary}`);
  if (jobType)  parts.push(`💼 ${jobType}`);

  let body = parts.length > 0 ? parts.join(' · ') + '. ' : '';
  body += 'Apply now before the deadline!';
  if (deadline) body += ` Closes: ${deadline}.`;

  return { title, body };
}

// ─────────────────────────────────────────────
// 📋 TEMPLATE 2 — GENERAL PUSH NOTIFICATION
// Used for interview slots, confirmations, messages, etc.
// All sender names come DYNAMICALLY from the doc — nothing hardcoded.
// ─────────────────────────────────────────────
function buildPushNotificationTemplate(firstName, doc) {
  const d = doc.data || {};

  // ── Dynamically resolve sender / HR name ──
  // Priority: data.hrName → data.recruiterName → sentBy.adminName → empty
  const senderName = safeString(
    d.hrName || d.recruiterName || d.senderName || doc.sentBy?.adminName || ''
  ).trim();

  const action     = safeString(d.action || d.eventType || 'update');
  const jobTitle   = safeString(d.title || d.jobTitle || doc.title) || '';
  const company    = safeString(d.companyName || d.company);
  const location   = safeString(d.location || d.city || doc.targetCity);
  const slotTime   = safeString(d.slotTime || d.interviewTime || d.scheduledAt);

  // ── Build contextual intro (NO hardcoded names) ──
  let intro = '';
  if (senderName && action === 'interview') {
    intro = `${senderName} has scheduled your interview.`;
  } else if (senderName && action === 'shortlist') {
    intro = `${senderName} has shortlisted your profile!`;
  } else if (senderName) {
    intro = `${senderName} sent you an update.`;
  } else if (action === 'interview') {
    intro = 'Your interview slot is confirmed.';
  } else if (action === 'shortlist') {
    intro = 'Congratulations! You have been shortlisted.';
  } else {
    intro = 'You have a new update.';
  }

  // ── Title ──
  let title = '';
  if (firstName && action === 'interview') {
    title = `${firstName}, interview slot confirmed! 🕒`;
  } else if (firstName && action === 'shortlist') {
    title = `${firstName}, you're shortlisted! 🎉`;
  } else if (firstName) {
    title = `${firstName}, you have a new update 📬`;
  } else if (action === 'interview') {
    title = `Interview slot confirmed! 🕒`;
  } else {
    title = `New update for you 📬`;
  }

  // ── Body ──
  let body = intro;
  if (jobTitle) body += ` Role: ${jobTitle}`;
  if (company)  body += ` at ${company}`;
  if (location) body += `, ${location}`;
  if (slotTime) body += `. Slot: ${slotTime}`;
  body += '. Tap to view details.';

  return { title, body };
}

// ─────────────────────────────────────────────
// 🔀 TEMPLATE ROUTER — picks the right builder
// ─────────────────────────────────────────────
function buildTemplate(firstName, doc) {
  const type = String(doc.type || '').toLowerCase().trim();

  const JOB_TYPES = ['job_alert', 'new_job', 'job', 'job_opening', 'job_post'];

  if (JOB_TYPES.includes(type)) {
    return buildJobNotificationTemplate(firstName, doc);
  }

  return buildPushNotificationTemplate(firstName, doc);
}

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

  const users = await User.find(query).select('fcmTokens name').lean();
  return users;
}

/**
 * Dispatches push notification from a MongoDB Notification doc.
 * Automatically selects the correct template based on notification type.
 */
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

  const globalDataPayload = {
    type: mobileType,
    notificationId: String(notificationDoc._id),
    ...(notificationDoc.data || {}),
  };

  // ── PERSONALIZED SEND (< 2000 users) ──
  if (!isBulkSend) {
    let successCount = 0;
    let failureCount = 0;
    let invalidTokensRemoved = 0;

    console.log(`[FCM] Sending personalized alerts to ${users.length} users...`);

    for (const u of users) {
      const firstName = getFirstName(u.name);

      // 🔀 Auto-select template: Job vs Push
      const { title, body } = buildTemplate(firstName, notificationDoc);

      const tokens = (u.fcmTokens || []).map(t => t.token).filter(Boolean);
      if (!tokens.length) continue;

      const res = await sendToTokens(
        tokens,
        { title, body, imageUrl: notificationDoc.imageUrl || '' },
        { ...globalDataPayload, title, body }
      );

      successCount += res.successCount || 0;
      failureCount += res.failureCount || 0;
      invalidTokensRemoved += res.invalidTokensRemoved || 0;
    }

    return { success: successCount > 0, successCount, failureCount, invalidTokensRemoved };
  }

  // ── BULK MULTICAST (≥ 2000 users, no personalization) ──
  console.log(`[FCM] Sending bulk multicast to ${users.length} recipients...`);

  const { title, body } = buildTemplate('', notificationDoc);

  const allTokens = [];
  users.forEach((u) => {
    u.fcmTokens?.forEach((t) => {
      if (t.token) allTokens.push(t.token);
    });
  });

  return sendToTokens(
    allTokens,
    { title, body, imageUrl: notificationDoc.imageUrl || '' },
    { ...globalDataPayload, title, body }
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