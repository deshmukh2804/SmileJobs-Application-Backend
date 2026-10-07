const Notification = require('../models/Notification');
const Job = require('../models/Job');
const { pushForNotification } = require('./notificationService');

let notifChangeStream = null;
let jobChangeStream = null;
let jobUpdateChangeStream = null; // 🆕 NEW: watch for job approval updates
let isPolling = false;

/**
 * 🔒 HELPER: Check if a job is approved before sending notifications
 */
function isJobApproved(job) {
  if (!job) return false;
  return (
    job.approvalStatus === 'approved' &&
    job.status === 'Live' &&
    job.isActive === true
  );
}

/**
 * Handles newly inserted job in database.
 * Auto-creates a Notification doc in MongoDB.
 * 🔒 NEW: Only creates notification if job is APPROVED.
 * NOTE: We DO NOT call processNotification() manually here, 
 * because MongoDB insertion will automatically trigger the ChangeStream / Poller.
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
    const city = job.city || job.location || job.subLocation || 'your area';
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
      pushProcessed: false, // Will be claimed atomically by processNotification
      sentAt: new Date(),
    });

    console.log(`[JobWatcher] 📢 Notification document created in DB: ${notif._id}`);
  } catch (err) {
    console.error('[JobWatcher] Error handling new job:', err.message);
  }
}

/**
 * 🆕 NEW: Handles when a job gets APPROVED later (admin approves pending job).
 * Triggers notification creation at the moment of approval.
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
    const city = job.city || job.location?.city || job.subLocation || 'your area';
    const salary = job.salary ? ` (${typeof job.salary === 'object' ? '' : job.salary})` : '';

    console.log(`[JobWatcher] ✅ Job APPROVED: "${job.title}" — creating notification now.`);

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

    console.log(`[JobWatcher] 📢 Approval-triggered notification created: ${notif._id}`);
  } catch (err) {
    console.error('[JobWatcher] Error handling job approval:', err.message);
  }
}

/**
 * Dispatches push notification to devices.
 * Uses ATOMIC LOCKING to prevent duplicate sends!
 * 🔒 NEW: Verifies linked job is still approved before sending.
 */
async function processNotification(notifOrId) {
  try {
    const notificationId = typeof notifOrId === 'object' ? notifOrId._id : notifOrId;
    if (!notificationId) return;

    // 🔒 ATOMIC LOCK: Claim this notification immediately in MongoDB.
    // If another thread/poller already set pushProcessed = true, targetDoc will be NULL.
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

    // If targetDoc is null, it means it was ALREADY processed by ChangeStream/Poller! Abort.
    if (!targetDoc) {
      return; 
    }

    // 🔒 FINAL CHECK: If this notification is linked to a job, verify the job is still approved
    const linkedJobId = targetDoc?.data?.jobId;
    if (linkedJobId) {
      try {
        const linkedJob = await Job.findById(linkedJobId).select('approvalStatus status isActive title').lean();
        if (!linkedJob || !isJobApproved(linkedJob)) {
          console.log(`[Watcher] 🚫 Blocked push for unapproved/missing job (${linkedJobId}). Notification: ${targetDoc.title}`);
          await Notification.updateOne(
            { _id: targetDoc._id },
            { $set: { status: 'blocked', 'stats.pushSent': 0, 'stats.pushFailed': 0 }, $push: { errorLog: '[BLOCKED] Linked job not approved.' } }
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
 * Fallback polling every 5s to process any pending notifications.
 */
function startPolling() {
  if (isPolling) return;
  isPolling = true;

  const INTERVAL = 5000;
  const poll = async () => {
    try {
      // Find notifications that haven't been processed yet
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

      // 🆕 NEW: Polling fallback to detect newly approved jobs that may need notifications
      const recentlyApprovedJobs = await Job.find({
        approvalStatus: 'approved',
        status: 'Live',
        isActive: true,
        approvedAt: { $gte: new Date(Date.now() - 60000) } // approved within last 60s
      })
        .select('_id title companyName location salary company subLocation city')
        .limit(20)
        .lean();

      for (const job of recentlyApprovedJobs) {
        const already = await Notification.findOne({ 'data.jobId': String(job._id) }).select('_id').lean();
        if (!already) {
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

    // 🆕 NEW: Watch for job UPDATES (approvalStatus changes from pending -> approved)
    jobUpdateChangeStream = Job.watch(
      [{ $match: { operationType: 'update' } }],
      { fullDocument: 'updateLookup' }
    );

    jobUpdateChangeStream.on('change', async (change) => {
      const doc = change.fullDocument;
      const updatedFields = change.updateDescription?.updatedFields || {};
      // Only trigger if approvalStatus field was changed to 'approved'
      if (doc && updatedFields.approvalStatus === 'approved') {
        console.log(`[JobWatcher] 🔄 Job approval update detected: ${doc._id}`);
        await handleJobApproval(doc);
      }
    });

    jobUpdateChangeStream.on('error', (err) => {
      console.warn('[Watcher] Job update stream warning:', err.message);
    });

    console.log('✅ [Watcher] Real-Time MongoDB Change Stream active');
    startPolling(); // Polling runs safely now thanks to atomic locking
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