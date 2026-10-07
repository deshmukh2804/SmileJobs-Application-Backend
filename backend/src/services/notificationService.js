const { getMessaging } = require('firebase-admin/messaging');
const { initFirebaseAdmin } = require('../config/firebaseAdmin');
const User = require('../models/User');
const Job = require('../models/Job'); // ✅ Imported to fetch job details
const { mapType } = require('./notificationTypeMap');

// ═══════════════════════════════════════════════════════════════
// SAFE STRING EXTRACTOR
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
    const candidates = [val.display, val.name, val.text, val.label, val.title, val.city, val.subLocation, val.area, val.address];
    for (const c of candidates) {
      const s = safeString(c);
      if (s) return s;
    }
    return '';
  }
  return String(val);
}

// ═══════════════════════════════════════════════════════════════
// SALARY FORMATTER
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
// LOCATION EXTRACTOR
// ═══════════════════════════════════════════════════════════════
function extractLocationArea(location) {
  if (!location) return '';
  if (typeof location === 'string') return safeString(location);
  if (typeof location === 'object') {
    return safeString(location.subLocation) || safeString(location.area) || safeString(location.address) || safeString(location.locality) || '';
  }
  return '';
}

function extractCity(location, fallbackCity) {
  if (location && typeof location === 'object') {
    const city = safeString(location.city);
    if (city) return city;
  }
  if (location && typeof location === 'string') {
    const parts = location.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length) return parts[0];
  }
  return safeString(fallbackCity);
}

// ═══════════════════════════════════════════════════════════════
// 🔒 NEW HELPER: Verify job approval
// ═══════════════════════════════════════════════════════════════
function isJobApproved(job) {
  if (!job) return false;
  return (
    job.approvalStatus === 'approved' &&
    job.status === 'Live' &&
    job.isActive === true
  );
}

// ═══════════════════════════════════════════════════════════════
// TEMPLATE BUILDER (Multi-line layout exactly like the image)
// ═══════════════════════════════════════════════════════════════
function buildJobNotificationTemplate(doc, userName = '') {
  const d = doc.data || {};
  const type = String(doc.type || '').toLowerCase().trim();

  const hrName    = safeString(d.hrName) || safeString(d.contactPerson?.name) || 'HR';
  const jobRole   = safeString(d.jobRole) || safeString(d.title) || safeString(doc.title) || safeString(d.role);
  const salary    = formatSalary(d.salary) || safeString(d.salaryRange);
  const location  = extractLocationArea(d.location) || safeString(d.subLocation) || safeString(d.area);
  const city      = extractCity(d.location, d.city || doc.targetCity);
  const company   = safeString(d.company) || safeString(d.companyName);

  let title = '';
  const isStatusUpdate = [
    'profile_review', 'application_viewed', 'application_shortlisted',
    'application_interview', 'application_offered', 'application_hired',
    'application_rejected'
  ].includes(type);

  // 1. SET THE TITLE
  if (isStatusUpdate) {
    const firstName = userName.split(' ')[0] || '';
    const statusMap = {
      profile_review: 'already reviewed your profile.',
      application_viewed: 'viewed your application.',
      application_shortlisted: 'shortlisted you for the next round! 🎉',
      application_interview: 'scheduled your interview! 📅',
      application_offered: 'extended you a job offer! 🎊',
      application_hired: 'hired you! Congratulations! 🎉',
      application_rejected: 'reviewed your application.'
    };
    const statusText = statusMap[type] || 'has an update on your application.';
    title = firstName ? `${firstName}, ${hrName} ${statusText}` : `${hrName} ${statusText}`;
  } else {
    // IT'S A NEW JOB ALERT
    title = company ? `New Job Alert: ${company} 🔥` : `New Job Opening! 🔥`;
  }

  // 2. SET THE MULTI-LINE BODY
  const parts = [];
  if (jobRole)  parts.push(jobRole);
  if (salary)   parts.push(`Salary : ${salary}`);
  if (location) parts.push(`Location : ${location}`);
  if (city)     parts.push(`City : ${city}`);

  let body = '';
  if (parts.length > 0) {
    parts.push('');
    parts.push('VIEW DETAILS');
    body = parts.join('\n');
  } else {
    body = safeString(doc.body) || 'Tap to view details.';
  }

  return { title, body };
}

function buildPushNotificationTemplate(doc, userName = '') {
  const title = safeString(doc.title) || (userName ? `Hello ${userName.split(' ')[0]}, new update available 📬` : 'New update available 📬');
  const body = safeString(doc.body) || 'Tap to view details.';
  return { title, body };
}

function buildTemplate(doc, userName = '') {
  const type = String(doc.type || '').toLowerCase().trim();
  const JOB_TYPES = [
    'job_alert', 'new_job', 'job', 'job_opening', 'job_post',
    'profile_review', 'application_viewed', 'application_shortlisted',
    'application_interview', 'application_offered', 'application_hired',
    'application_rejected', 'application_update'
  ];
  if (JOB_TYPES.includes(type)) return buildJobNotificationTemplate(doc, userName);
  return buildPushNotificationTemplate(doc, userName);
}

// ═══════════════════════════════════════════════════════════════
// FIREBASE FCM SENDER
// ═══════════════════════════════════════════════════════════════
async function sendToTokens(tokens, notification, data = {}) {
  const app = initFirebaseAdmin();
  if (!app) return { success: false, message: 'Firebase Admin not initialized', successCount: 0, failureCount: 0 };

  const messaging = getMessaging(app);
  const tokenArray = [...new Set((Array.isArray(tokens) ? tokens : [tokens]).filter(Boolean))];
  if (!tokenArray.length) return { success: false, message: 'No unique tokens provided', successCount: 0, failureCount: 0 };

  const stringifiedData = {};
  Object.keys(data || {}).forEach((key) => {
    const v = data[key];
    if (v === null || v === undefined) stringifiedData[key] = '';
    else if (typeof v === 'object') {
      try { stringifiedData[key] = JSON.stringify(v); } catch { stringifiedData[key] = ''; }
    } else stringifiedData[key] = String(v);
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
      notification: {
        channelId: 'default',
        sound: 'default',
        priority: 'max',
        defaultSound: true,
        defaultVibrateTimings: true,
        ...(notification.imageUrl ? { imageUrl: notification.imageUrl } : {}),
      },
    },
  };

  try {
    let totalSuccess = 0; let totalFailure = 0; const invalidTokens = [];
    const CHUNK_SIZE = 500;

    for (let i = 0; i < tokenArray.length; i += CHUNK_SIZE) {
      const chunk = tokenArray.slice(i, i + CHUNK_SIZE);
      const response = await messaging.sendEachForMulticast({ ...messagePayload, tokens: chunk });
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

// ═══════════════════════════════════════════════════════════════
// AUDIENCE RESOLVER
// ═══════════════════════════════════════════════════════════════
async function resolveTargetUsers(notificationDoc) {
  const audience = String(notificationDoc.targetAudience || 'all').toLowerCase().trim();
  let query = { 'fcmTokens.0': { $exists: true } };

  if (['candidates', 'candidate', 'job_seeker'].includes(audience)) {
    query.$or = [{ role: { $in: ['job_seeker', 'candidate', 'user', 'seeker', ''] } }, { role: { $exists: false } }];
  } else if (audience === 'city' && notificationDoc.targetCity) {
    query.$or = [
      { city: new RegExp(`^${notificationDoc.targetCity}$`, 'i') },
      { 'location.city': new RegExp(`^${notificationDoc.targetCity}$`, 'i') }
    ];
  }
  return await User.find(query).select('fcmTokens name city').lean();
}

// ═══════════════════════════════════════════════════════════════
// 🚀 DB ENRICHER (Fixes missing Job Info in New Alerts)
// 🔒 UPDATED: Also returns job approval status to block unapproved jobs
// ═══════════════════════════════════════════════════════════════
async function enrichNotificationWithJobData(notificationDoc) {
  if (!notificationDoc.data) notificationDoc.data = {};
  
  // If notification has jobId, we fetch job info AND check approval status
  if (notificationDoc.data.jobId) {
    try {
      const jobInfo = await Job.findById(notificationDoc.data.jobId).lean();
      
      // 🔒 NEW: Attach approval info so pushForNotification can check
      if (jobInfo) {
        notificationDoc._linkedJob = jobInfo;
        
        // Enrich only if missing
        if (!notificationDoc.data.salary || !notificationDoc.data.location) {
          notificationDoc.data.jobRole = jobInfo.title;
          notificationDoc.data.salary = jobInfo.salary;
          notificationDoc.data.location = jobInfo.location;
          notificationDoc.data.company = jobInfo.companyName;
          notificationDoc.data.city = jobInfo.location?.city;
          notificationDoc.data.hrName = jobInfo.contactPerson?.name || 'HR';
        }
      } else {
        notificationDoc._linkedJob = null;
      }
    } catch (e) {
      console.log('[FCM-ENRICH] Error fetching job data:', e.message);
    }
  }
  return notificationDoc;
}

// ═══════════════════════════════════════════════════════════════
// PUSH PROCESSOR
// 🔒 UPDATED: Blocks push if linked job is not approved
// ═══════════════════════════════════════════════════════════════
async function pushForNotification(notificationDoc) {
  // 1. Fetch missing database info first!
  notificationDoc = await enrichNotificationWithJobData(notificationDoc);

  // 🔒 FINAL SAFETY GATE: If notification is linked to a job, verify it is approved
  if (notificationDoc?.data?.jobId) {
    const linkedJob = notificationDoc._linkedJob;
    if (!linkedJob) {
      console.log(`[FCM] 🚫 Blocked push — linked job (${notificationDoc.data.jobId}) not found in DB.`);
      return { success: false, message: 'Linked job not found', successCount: 0, failureCount: 0 };
    }
    if (!isJobApproved(linkedJob)) {
      console.log(`[FCM] 🚫 Blocked push — linked job (${notificationDoc.data.jobId}) is not approved. Status: ${linkedJob.approvalStatus}`);
      return { success: false, message: `Job not approved (status: ${linkedJob.approvalStatus})`, successCount: 0, failureCount: 0 };
    }
  }

  const users = await resolveTargetUsers(notificationDoc);
  if (!users.length) return { success: false, message: 'No users found' };

  const mobileType = mapType(notificationDoc.type);
  const isBulkSend = users.length > 2000;

  if (!isBulkSend) {
    for (const u of users) {
      const tokens = [...new Set((u.fcmTokens || []).map((t) => t.token).filter(Boolean))];
      if (!tokens.length) continue;

      const { title, body } = buildTemplate(notificationDoc, u.name || '');
      const dataPayload = { type: mobileType, notificationId: String(notificationDoc._id || ''), title, body, ...notificationDoc.data };

      await sendToTokens(tokens, { title, body, imageUrl: notificationDoc.imageUrl || '' }, dataPayload);
    }
    return { success: true };
  } else {
    const { title, body } = buildTemplate(notificationDoc, '');
    const allTokens = [...new Set(users.flatMap((u) => (u.fcmTokens || []).map((t) => t.token).filter(Boolean)))];
    const dataPayload = { type: mobileType, notificationId: String(notificationDoc._id || ''), title, body, ...notificationDoc.data };
    return sendToTokens(allTokens, { title, body, imageUrl: notificationDoc.imageUrl || '' }, dataPayload);
  }
}

// ═══════════════════════════════════════════════════════════════
// DIRECT NOTIFICATION
// 🔒 UPDATED: Checks job approval before sending direct notification
// ═══════════════════════════════════════════════════════════════
async function sendDirectNotificationToUser(userId, notificationData) {
  try {
    const user = await User.findById(userId).select('fcmTokens name').lean();
    if (!user || !user.fcmTokens?.length) return { success: false };

    const virtualDoc = await enrichNotificationWithJobData({
      type: notificationData.type,
      data: notificationData.data || {},
      imageUrl: notificationData.imageUrl || '',
    });

    // 🔒 FINAL SAFETY GATE: Verify linked job is approved
    if (virtualDoc?.data?.jobId) {
      const linkedJob = virtualDoc._linkedJob;
      if (!linkedJob || !isJobApproved(linkedJob)) {
        console.log(`[FCM-DIRECT] 🚫 Blocked direct push — job not approved: ${virtualDoc.data.jobId}`);
        return { success: false, message: 'Linked job not approved' };
      }
    }

    const tokens = user.fcmTokens.map((t) => t.token).filter(Boolean);
    const { title, body } = buildTemplate(virtualDoc, user.name || '');
    
    const dataPayload = { type: mapType(notificationData.type), title, body, ...virtualDoc.data };

    return await sendToTokens(tokens, { title, body, imageUrl: virtualDoc.imageUrl }, dataPayload);
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = {
  sendToTokens, resolveTargetUsers, pushForNotification, sendDirectNotificationToUser,
  buildJobNotificationTemplate, buildTemplate, safeString, formatSalary, extractLocationArea, extractCity,
  isJobApproved  // 🆕 Exported for other modules
};