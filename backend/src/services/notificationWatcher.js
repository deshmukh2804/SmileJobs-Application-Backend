const Notification = require('../models/Notification');
const Job = require('../models/Job');
const { pushForNotification } = require('./notificationService');

let notifChangeStream = null;
let jobChangeStream = null;
let isPolling = false;

async function handleNewJob(job) {
  try {
    if (!job || !job._id) return;

    const existing = await Notification.findOne({ 'data.jobId': String(job._id) });
    if (existing) return;

    const company = job.company || job.companyName || 'Top Company';
    const city = job.city || job.location || job.subLocation || 'your area';
    const salary = job.salary ? ` (${job.salary})` : '';

    console.log(`[JobWatcher] 💼 New Job detected: "${job.title}" at ${company}`);

    const notif = await Notification.create({
      title: `🔥 New Job Alert: ${job.title}`,
      body: `${company} is hiring in ${city}${salary}. Tap to view & apply now!`,
      targetAudience: 'candidates', // broader than role/job_seeker only
      targetRole: 'job_seeker',
      type: 'job_alert',
      channels: { inApp: true, push: true, email: false },
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

    console.log(`[JobWatcher] 📢 Notification created: ${notif._id}`);

    // Always try push immediately as well
    await processNotification(notif);
  } catch (err) {
    console.error('[JobWatcher] Error handling new job:', err.message);
  }
}

async function processNotification(notif) {
  try {
    if (!notif || notif.pushProcessed) return;

    if (notif.channels && notif.channels.push === false) {
      await Notification.updateOne({ _id: notif._id }, { $set: { pushProcessed: true } });
      return;
    }

    console.log(`[Watcher] 🚀 Push → "${notif.title}" | audience=${notif.targetAudience}`);

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

    console.log(`[Watcher] 🏁 pushSent=${result.successCount} pushFailed=${result.failureCount}`);
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
      console.warn('[Watcher] Notif stream error → polling:', err.message);
      if (notifChangeStream) {
        try { notifChangeStream.close(); } catch (_) {}
        notifChangeStream = null;
      }
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
      console.warn('[Watcher] Job stream error:', err.message);
      if (jobChangeStream) {
        try { jobChangeStream.close(); } catch (_) {}
        jobChangeStream = null;
      }
    });

    console.log('✅ [Watcher] Change streams active (Notifications + Jobs)');
    // Also start polling as safety net (Render / some clusters drop streams)
    startPolling();
    return true;
  } catch (err) {
    console.warn('[Watcher] Change stream unavailable:', err.message);
    return false;
  }
}

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

      if (pending.length) {
        console.log(`[Watcher-Poll] Found ${pending.length} pending push(es)`);
      }

      for (const item of pending) {
        await processNotification(item);
      }
    } catch (err) {
      console.error('[Watcher-Polling] error:', err.message);
    } finally {
      setTimeout(poll, INTERVAL);
    }
  };

  poll();
  console.log('✅ [Watcher] Polling active (every 5s)');
}

function startNotificationWatcher() {
  setTimeout(() => {
    const started = startChangeStream();
    if (!started) startPolling();
  }, 2000);
}

module.exports = {
  startNotificationWatcher,
  processNotification,
  handleNewJob,
};