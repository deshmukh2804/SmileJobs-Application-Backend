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
    // Safely extract the most appropriate display field
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

  // ✅ Fetch user name alongside fcmTokens for premium personalization
  const users = await User.find(query).select('fcmTokens name').lean();
  return users;
}

/**
 * Dispatches push notification directly from a MongoDB Notification doc.
 * Formats alerts similarly to premium Indian job portals.
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

  // ── 1. DYNAMIC VALUE PARSING (No Hardcoding) ──
  const rawJobTitle = notificationDoc.data?.title || notificationDoc.data?.jobTitle || notificationDoc.title || '';
  const rawCompany = notificationDoc.data?.companyName || notificationDoc.data?.company || '';
  const rawLocation = notificationDoc.data?.location || notificationDoc.data?.city || notificationDoc.targetCity || '';
  const rawSalary = notificationDoc.data?.salary || notificationDoc.data?.currentSalary || '';
  
  // Resolve HR name dynamically from payload or sender admin details
  const rawHrName = notificationDoc.data?.hrName || notificationDoc.data?.recruiterName || notificationDoc.sentBy?.adminName || '';
  const hrName = safeString(rawHrName).trim();

  // Resolve work/job types dynamically (Full Time, Part Time, Internship)
  const rawJobType = notificationDoc.data?.workType || notificationDoc.data?.jobType || notificationDoc.data?.type || '';
  const jobType = safeString(rawJobType).trim();

  const jobTitle = safeString(rawJobTitle) || 'Job Opening';
  const company = safeString(rawCompany);
  const location = safeString(rawLocation);
  const salary = safeString(rawSalary);

  // ── 2. PROCESS HIGH-SPEED INDIVIDUAL PERSONALIZATION ──
  const isBulkSend = users.length > 2000;
  const mobileType = mapType(notificationDoc.type);

  // Fallback to generic introductory statements if no specific HR name is specified
  const introStatement = hrName 
    ? `${hrName} HR wants to confirm.` 
    : 'Hiring Manager wants to confirm.';

  const globalDataPayload = {
    type: mobileType,
    notificationId: String(notificationDoc._id),
    title: jobTitle,
    body: `${introStatement} Tap to Book your Slot.`,
    ...(notificationDoc.data || {}),
  };

  if (!isBulkSend) {
    let successCount = 0;
    let failureCount = 0;
    let invalidTokensRemoved = 0;

    console.log(`[FCM] Sending personalized alerts to ${users.length} users...`);

    for (const u of users) {
      const firstName = getFirstName(u.name);
      
      // Personalized Indian style template
      const personalizedTitle = firstName 
        ? `${firstName}, interview slots closing! 🕒` 
        : `Interview slots closing! 🕒`;

      let jobSuffix = jobTitle;
      if (jobType) jobSuffix += ` (${jobType})`;

      let personalizedBody = `${introStatement} Tap to Book your Slot. ${jobSuffix}`;
      if (company) personalizedBody += ` at ${company}`;
      if (location) personalizedBody += `, ${location} me`;
      if (salary) personalizedBody += `. Salary: ${salary}`;

      const tokens = (u.fcmTokens || []).map(t => t.token).filter(Boolean);
      if (!tokens.length) continue;

      const res = await sendToTokens(
        tokens,
        {
          title: personalizedTitle,
          body: personalizedBody,
          imageUrl: notificationDoc.imageUrl || '',
        },
        {
          ...globalDataPayload,
          title: personalizedTitle,
          body: personalizedBody,
        }
      );

      successCount += res.successCount || 0;
      failureCount += res.failureCount || 0;
      invalidTokensRemoved += res.invalidTokensRemoved || 0;
    }

    return {
      success: successCount > 0,
      successCount,
      failureCount,
      invalidTokensRemoved,
    };
  }

  // ── 3. HIGH-SPEED BULK MULTICAST FALLBACK (For large target groups) ──
  console.log(`[FCM] Sending general bulk multicast alerts to ${users.length} recipients...`);
  
  const generalTitle = `Interview slots closing! 🕒`;
  let jobSuffixBulk = jobTitle;
  if (jobType) jobSuffixBulk += ` (${jobType})`;

  let generalBody = `${introStatement} Tap to Book your Slot. ${jobSuffixBulk}`;
  if (company) generalBody += ` at ${company}`;
  if (location) generalBody += `, ${location} me`;
  if (salary) generalBody += `. Salary: ${salary}`;

  const allTokens = [];
  users.forEach((u) => {
    u.fcmTokens?.forEach((t) => {
      if (t.token) allTokens.push(t.token);
    });
  });

  return sendToTokens(
    allTokens,
    {
      title: generalTitle,
      body: generalBody,
      imageUrl: notificationDoc.imageUrl || '',
    },
    {
      ...globalDataPayload,
      title: generalTitle,
      body: generalBody,
    }
  );
}

module.exports = {
  sendToTokens,
  resolveTargetUsers,
  pushForNotification,
};