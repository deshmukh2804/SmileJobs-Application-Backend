const Notification = require('../models/Notification');
const Job = require('../models/Job');
const { pushForNotification } = require('./notificationService');

let notifChangeStream = null;
let jobChangeStream = null;
let isPolling = false;

/**
 * Handles newly inserted job in database.
 * Auto-creates a Notification doc that targets candidates/job seekers.
 */
async function handleNewJob(job) {
  try {
    if (!job || !job._id) return;

    // Prevent duplicate notifications for the same job
    const existing = await Notification.findOne({ 'data.jobId': String(job._id) });
    if (existing) return;

    const company = job.company || job.companyName || 'Top Company';
    const city = job.city || job.location || job.subLocation || 'your area';
    const salary = job.salary ? ` (${job.salary})` : '';

    console.log(`[JobWatcher] 💼 New Job detected: "${job.title}" at ${company}`);

    // Create notification targeting candidates
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

    console.log(`[JobWatcher] 📢 Notification document created: ${notif._id}`);

    // Immediately attempt push
    await processNotification(notif);
  } catch (err) {
    console.error('[JobWatcher] Error handling new job:', err.message);
  }
}

/**
 * Dispatches push notification to devices.
 */
async function processNotification(notif) {
  try {
    if (!notif || notif.pushProcessed) return;

    if (notif.channels && notif.channels.push === false) {
      await Notification.updateOne({ _id: notif._id }, { $set: { pushProcessed: true } });
      return;
    }

    console.log(`[Watcher] 🚀 Processing push for "${notif.title}" (Audience: ${notif.targetAudience})`);

    const result = await pushForNotification(notif);

    await Notification.updateOne(
      { _id: notif._id },
      {
        $set: {
          pushProcessed: true,
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
    try {
      await Notification.updateOne(
        { _id: notif._id },
        {
          $set: { pushProcessed: true },
          $push: { errorLog: `[FCM Error] ${err.message}` },
        }
      );
    } catch (_) {}
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
      const pending = await Notification.find({
        pushProcessed: { $ne: true },
        status: { $in: ['sent', 'pending'] },
        'channels.push': { $ne: false },
      })
        .sort({ createdAt: 1 })
        .limit(10);

      if (pending.length > 0) {
        console.log(`[Watcher-Polling] Found ${pending.length} unprocessed notifications. Dispatching...`);
      }

      for (const item of pending) {
        await processNotification(item);
      }
    } catch (err) {
      console.error('[Watcher-Polling] Poll error:', err.message);
    } finally {
      setTimeout(poll, INTERVAL);
    }
  };

  poll();
  console.log('✅ [Watcher] Polling service active (5s interval)');
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
      if (doc) await processNotification(doc);
    });

    notifChangeStream.on('error', (err) => {
      console.warn('[Watcher] Change stream unavailable/failed, maintaining polling fallback:', err.message);
      startPolling();
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

    console.log('✅ [Watcher] Real-Time MongoDB Change Stream active');
    startPolling(); // Always run polling alongside as a fail-safe on cloud platforms
    return true;
  } catch (err) {
    console.warn('[Watcher] Change stream init error, starting polling fallback:', err.message);
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
};