const Notification = require('../models/Notification');
const Job = require('../models/Job');
const { pushForNotification } = require('./notificationService');

let notifChangeStream = null;
let jobChangeStream = null;
let jobUpdateChangeStream = null; 
let isPolling = false;

/**
 * 🔒 HELPER: Check if a job is approved, active, and live
 * Case-insensitive safety check to handle any database variations
 */
function isJobApproved(job) {
  if (!job) return false;
  const approval = String(job.approvalStatus || '').toLowerCase().trim();
  const status = String(job.status || '').toLowerCase().trim();
  const active = job.isActive === true || String(job.isActive) === 'true';
  
  return approval === 'approved' && status === 'live' && active;
}

/**
 * Handles newly inserted job in database.
 * Auto-creates a Notification doc in MongoDB and sends immediately if approved.
 */
async function handleNewJob(job) {
  try {
    if (!job || !job._id) return;

    // 🔒 BLOCK: Do not create notifications for unapproved jobs
    if (!isJobApproved(job)) {
      console.log(`[JobWatcher] ⏸️ Job "${job.title}" is NOT approved yet (status: ${job.approvalStatus}). Notification SKIPPED.`);
      return;
    }

    // Prevent duplicate notification creation for the same job ID
    const existing = await Notification.findOne({ 'data.jobId': String(job._id) });
    if (existing) return;

    const company = job.company || job.companyName || 'Top Company';
    const city = job.city || job.location?.city || job.location || 'your area';
    const salary = job.salary ? ` (${job.salary})` : '';

    console.log(`[JobWatcher] 💼 New APPROVED Job detected: "${job.title}" at ${company}`);

    // Create notification document in DB
    const notif = await Notification.create({
      title: `🔥 New Job Alert: ${job.title}`,
      body: `${company} is hiring in ${city}${salary}. Tap to view & apply now!`,
      targetAudience: 'candidates',
      targetRole: 'job_seeker',
      type: 'job_alert',
      channels: {
        inApp: true,
        push: true,
        email: false,
      },
      data: {
        type: 'JOB',
        jobId: String(job._id),
        company: String(company),
        title: String(job.title),
        city: String(city),
        salary: String(job.salary || ''),
      },
      status: 'sent',
      pushProcessed: false, 
      sentAt: new Date(),
    });

    console.log(`[JobWatcher] 📢 Notification document created in DB: ${notif._id}`);
    
    // 🚀 IMMEDIATE DISPATCH: Send notification immediately
    await processNotification(notif._id);
  } catch (err) {
    console.error('[JobWatcher] Error handling new job:', err.message);
  }
}

/**
 * Handles when a job gets APPROVED later (admin approves pending job).
 * Triggers notification creation and dispatches immediately at the moment of approval.
 */
async function handleJobApproval(job) {
  try {
    if (!job || !job._id) return;
    if (!isJobApproved(job)) return;

    // Prevent duplicate notification creation for the same job ID
    const existing = await Notification.findOne({ 'data.jobId': String(job._id) });
    if (existing) {
      console.log(`[JobWatcher] ℹ️ Notification already exists for job ${job._id}, skipping.`);
      return;
    }

    const company = job.company || job.companyName || 'Top Company';
    const city = job.location?.city || job.city || 'your area';
    
    // Safely extract salary string
    let salaryStr = '';
    if (job.salary) {
      if (typeof job.salary === 'object') {
        const min = job.salary.min || '';
        const max = job.salary.max || '';
        salaryStr = min && max ? ` (${min}-${max})` : '';
      } else {
        salaryStr = ` (${job.salary})`;
      }
    }

    console.log(`[JobWatcher] ✅ Job APPROVED: "${job.title}" — creating notification now.`);

    const notif = await Notification.create({
      title: `🔥 New Job Alert: ${job.title}`,
      body: `${company} is hiring in ${city}${salaryStr}. Tap to view & apply now!`,
      targetAudience: 'candidates',
      targetRole: 'job_seeker',
      type: 'job_alert',
      channels: {
        inApp: true,
        push: true,
        email: false,
      },
      data: {
        type: 'JOB',
        jobId: String(job._id),
        company: String(company),
        title: String(job.title),
        city: String(city),
        salary: String(job.salary?.min || job.salary || ''),
      },
      status: 'sent',
      pushProcessed: false,
      sentAt: new Date(),
    });

    console.log(`[JobWatcher] 📢 Approval-triggered notification created in DB: ${notif._id}`);
    
    // 🚀 IMMEDIATE DISPATCH: Send notification immediately without waiting for Poller cycles
    await processNotification(notif._id);
  } catch (err) {
    console.error('[JobWatcher] Error handling job approval:', err.message);
  }
}

/**
 * Dispatches push notification to devices.
 * Uses ATOMIC LOCKING to prevent duplicate sends!
 */
async function processNotification(notifOrId) {
  try {
    const notificationId = typeof notifOrId === 'object' ? notifOrId._id : notifOrId;
    if (!notificationId) return;

    // 🔒 ATOMIC LOCK: Claim this notification immediately in MongoDB.
    const targetDoc = await Notification.findOneAndUpdate(
      { 
        _id: notificationId, 
        pushProcessed: { $ne: true },
        'channels.push': { $ne: false } 
      },
      { 
        $set: { pushProcessed: true } 
      },
      { 
        new: true 
      }
    );

    if (!targetDoc) {
      return; // Already processed, return immediately to avoid duplicates
    }

    // 🔒 FINAL CHECK: Verify the linked job is still approved
    const linkedJobId = targetDoc?.data?.jobId;
    if (linkedJobId) {
      try {
        const linkedJob = await Job.findById(linkedJobId).select('approvalStatus status isActive title').lean();
        if (!linkedJob || !isJobApproved(linkedJob)) {
          console.log(`[Watcher] 🚫 Blocked push for unapproved/missing job (${linkedJobId}). Notification: ${targetDoc.title}`);
          await Notification.updateOne(
            { _id: targetDoc._id },
            { 
              $set: { 
                status: 'blocked', 
                'stats.pushSent': 0, 
                'stats.pushFailed': 0 
              }, 
              $push: { errorLog: '[BLOCKED] Linked job not approved.' } 
            }
          );
          return;
        }
      } catch (checkErr) {
        console.error('[Watcher] Error verifying linked job approval:', checkErr.message);
        return;
      }
    }

    console.log(`[Watcher] 🔒 Claimed lock for notification: "${targetDoc.title}" (${targetDoc._id})`);
    console.log(`[Watcher] 🚀 Processing push dispatch...`);

    const result = await pushForNotification(targetDoc);

    // Update stats after push is done
    await Notification.updateOne(
      { _id: targetDoc._id },
      {
        $set: {
          'stats.pushSent': result.successCount || 0,
          'stats.pushFailed': result.failureCount || 0,
        },
        ...(!result.success && result.message
          ? { $push: { errorLog: `[FCM] ${result.message}` } }
          : {}),
      }
    );

    console.log(`[Watcher] 🏁 Finished dispatch: ${result.successCount} sent, ${result.failureCount} failed`);
  } catch (err) {
    console.error('[Watcher] Process error:', err.message);
  }
}

/**
 * Fallback polling every 5s to process pending notifications
 * and search for newly approved jobs that missed notifications.
 */
function startPolling() {
  if (isPolling) return;
  isPolling = true;

  const INTERVAL = 5000;
  const poll = async () => {
    try {
      // 1. Process pending unsent notifications
      const pending = await Notification.find({
        pushProcessed: { $ne: true },
        status: { $in: ['sent', 'pending'] },
        'channels.push': { $ne: false },
      })
        .select('_id')
        .sort({ createdAt: 1 })
        .limit(10);

      for (const item of pending) {
        await processNotification(item._id);
      }

      // 2. 🔒 CLOCK-FREE POLLING BACKUP: Fetch recently updated approved jobs.
      // Scan recent approved jobs and create notifications if they are missing
      const recentlyApprovedJobs = await Job.find({
        approvalStatus: 'approved',
        status: 'Live',
        isActive: true
      })
        .sort({ updatedAt: -1 }) 
        .limit(20)
        .lean();

      for (const job of recentlyApprovedJobs) {
        const alreadyExists = await Notification.findOne({ 'data.jobId': String(job._id) }).select('_id').lean();
        if (!alreadyExists) {
          console.log(`[Watcher-Polling] 🔌 Found approved job "${job.title}" missing notification. Generating...`);
          await handleJobApproval(job);
        }
      }
    } catch (err) {
      console.error('[Watcher-Polling] Poll error:', err.message);
    } finally {
      setTimeout(poll, INTERVAL);
    }
  };

  poll();
  console.log('✅ [Watcher] Polling fallback service active');
}

/**
 * Starts MongoDB Change Stream for Notifications and Jobs.
 */
function startChangeStream() {
  try {
    notifChangeStream = Notification.watch(
      [{ $match: { operationType: 'insert' } }],
      { fullDocument: 'updateLookup' }
    );

    notifChangeStream.on('change', async (change) => {
      const doc = change.fullDocument;
      if (doc && doc._id) {
        await processNotification(doc._id);
      }
    });

    notifChangeStream.on('error', (err) => {
      console.warn('[Watcher] Notification change stream error, running polling:', err.message);
    });

    jobChangeStream = Job.watch(
      [{ $match: { operationType: 'insert' } }],
      { fullDocument: 'updateLookup' }
    );

    jobChangeStream.on('change', async (change) => {
      const doc = change.fullDocument;
      if (doc) await handleNewJob(doc);
    });

    jobChangeStream.on('error', (err) => {
      console.warn('[Watcher] Job change stream warning:', err.message);
    });

    // Watch for job UPDATES (approvalStatus changes from pending -> approved)
    jobUpdateChangeStream = Job.watch(
      [{ $match: { operationType: 'update' } }],
      { fullDocument: 'updateLookup' }
    );

    jobUpdateChangeStream.on('change', async (change) => {
      const doc = change.fullDocument;
      // Read approval status directly from the full document update
      if (doc && isJobApproved(doc)) {
        console.log(`[JobWatcher] 🔄 Job approval update detected via change stream: ${doc._id}`);
        await handleJobApproval(doc);
      }
    });

    jobUpdateChangeStream.on('error', (err) => {
      console.warn('[Watcher] Job update stream warning:', err.message);
    });

    console.log('✅ [Watcher] Real-Time MongoDB Change Stream active');
    startPolling(); 
    return true;
  } catch (err) {
    console.warn('[Watcher] Change stream init error, fallback to polling:', err.message);
    startPolling();
    return false;
  }
}

function startNotificationWatcher() {
  setTimeout(() => {
    startChangeStream();
  }, 1000);
}

module.exports = {
  startNotificationWatcher,
  processNotification,
  handleNewJob,
  handleJobApproval,
};