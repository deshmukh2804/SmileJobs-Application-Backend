const Application = require('../models/Application');
const Job = require('../models/Job');
const User = require('../models/User');
const { sendDirectNotificationToUser } = require('../services/notificationService');

// ═══════════════════════════════════════════════════════════════
// HELPER: Calculate skill match percentage
// ═══════════════════════════════════════════════════════════════
function calculateMatch(jobSkills, userSkills) {
  if (!jobSkills || !jobSkills.length) return 60;
  const jLower = jobSkills.map((s) => String(s).toLowerCase().trim());
  const uLower = userSkills.map((s) => String(s).toLowerCase().trim());
  const matched = jLower.filter((s) => uLower.includes(s)).length;
  return Math.round((matched / jLower.length) * 100);
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Get status display config
// ═══════════════════════════════════════════════════════════════
function getStatusBadge(status) {
  const badgeMap = {
    Applied: { text: 'Applied Successfully', isHighlighted: false, category: 'pending' },
    Viewed: { text: 'HR Viewed Profile', isHighlighted: false, category: 'pending' },
    Shortlisted: { text: 'Shortlisted', isHighlighted: true, category: 'hr-responded' },
    Interview: { text: 'Interview Scheduled', isHighlighted: true, category: 'hr-responded' },
    Offered: { text: 'Offer Received', isHighlighted: true, category: 'offers' },
    Hired: { text: 'Hired - Congratulations!', isHighlighted: true, category: 'offers' },
    Rejected: { text: 'Not Selected', isHighlighted: false, category: 'expired' },
    Withdrawn: { text: 'Withdrawn', isHighlighted: false, category: 'expired' },
  };
  return badgeMap[status] || { text: 'In Pipeline', isHighlighted: false, category: 'pending' };
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Map status to notification type
// ═══════════════════════════════════════════════════════════════
function statusToNotificationType(status) {
  const map = {
    Viewed: 'profile_review',
    Shortlisted: 'application_shortlisted',
    Interview: 'application_interview',
    Offered: 'application_offered',
    Hired: 'application_hired',
    Rejected: 'application_rejected',
  };
  return map[status] || null;
}

// ═══════════════════════════════════════════════════════════════
// 🚀 NEW: Send status change notification to candidate
// Mirrors the WorkIndia-style template shown in the image
// ═══════════════════════════════════════════════════════════════
async function sendStatusChangeNotification(application, newStatus) {
  try {
    const notifType = statusToNotificationType(newStatus);
    if (!notifType) {
      console.log(`[STATUS-NOTIF] No notification configured for status: ${newStatus}`);
      return;
    }

    // Fetch LATEST job data (for accurate HR name, salary, location)
    const job = await Job.findById(application.jobId).lean();
    if (!job) {
      console.log('[STATUS-NOTIF] Job not found, skipping notification');
      return;
    }

    const notificationData = {
      type: notifType,
      _id: `status_${application._id}_${Date.now()}`,
      data: {
        // Pass raw objects — notificationService.js will format them properly
        jobId: String(application.jobId),
        applicationId: String(application._id),
        hrName: job.contactPerson?.name || application.jobHrName || 'HR',
        jobRole: job.title || application.jobTitle || '',
        title: job.title || application.jobTitle || '',
        salary: job.salary || null,  // raw object → formatSalary() will handle it
        location: job.location || null, // raw object → extractors will handle it
        city: job.location?.city || '',
        company: job.companyName || application.jobCompany || '',
        companyName: job.companyName || application.jobCompany || '',
        status: newStatus,
      },
      imageUrl: job.companyLogo?.url || '',
    };

    const result = await sendDirectNotificationToUser(application.userId, notificationData);
    console.log(`[STATUS-NOTIF] ✅ Sent "${newStatus}" notification to user ${application.userId}:`, result);
  } catch (err) {
    console.error('[STATUS-NOTIF] ❌ Failed:', err.message);
    // Don't throw — notification failure shouldn't block status update
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Build dynamic milestones based on current status
// ═══════════════════════════════════════════════════════════════
function buildMilestones(app) {
  const status = app.status;
  const isTerminal = ['Rejected', 'Withdrawn'].includes(status);

  const stages = [
    { key: 'Applied', title: 'Application Submitted', time: app.appliedAt ? formatDate(app.appliedAt) : 'Just now' },
    { key: 'Viewed', title: 'HR Viewed Your Profile', time: app.viewedAt ? formatDate(app.viewedAt) : null },
    { key: 'Shortlisted', title: 'Shortlisted for Next Round', time: app.shortlistedAt ? formatDate(app.shortlistedAt) : null },
    { key: 'Interview', title: 'Interview Scheduled', time: app.interviewAt ? formatDate(app.interviewAt) : null },
    { key: 'Offered', title: 'Offer Extended', time: app.offeredAt ? formatDate(app.offeredAt) : null },
    { key: 'Hired', title: 'Successfully Hired', time: app.hiredAt ? formatDate(app.hiredAt) : null },
  ];

  const stageOrder = ['Applied', 'Viewed', 'Shortlisted', 'Interview', 'Offered', 'Hired'];
  const currentIndex = stageOrder.indexOf(status);

  if (isTerminal) {
    const milestones = stages.map((stage) => {
      const wasCompleted =
        stage.key === 'Applied' ||
        (stage.key === 'Viewed' && app.viewedAt) ||
        (stage.key === 'Shortlisted' && app.shortlistedAt) ||
        (stage.key === 'Interview' && app.interviewAt) ||
        (stage.key === 'Offered' && app.offeredAt);
      return {
        title: stage.title,
        time: stage.time || '',
        completed: !!wasCompleted,
        statusText: '',
        isHighlight: false,
      };
    });

    milestones.push({
      title: status === 'Rejected' ? 'Application Not Selected' : 'Application Withdrawn',
      time: app.updatedAt ? formatDate(app.updatedAt) : '',
      completed: true,
      statusText: '',
      isHighlight: false,
    });
    return milestones;
  }

  return stages.map((stage) => {
    const stageIdx = stageOrder.indexOf(stage.key);
    const isCompleted = stageIdx <= currentIndex;
    const isCurrent = stageIdx === currentIndex;
    return {
      title: stage.title,
      time: stage.time || '',
      completed: isCompleted,
      statusText: isCurrent ? 'Current Stage' : '',
      isHighlight: isCurrent,
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Format date for display
// ═══════════════════════════════════════════════════════════════
function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / (1000 * 60));
  const diffHr = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getInitials(name) {
  if (!name) return 'HR';
  return String(name).split(' ').filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Transform application → mobile format
// ═══════════════════════════════════════════════════════════════
async function transformApplication(app) {
  let latestJob = null;
  try {
    latestJob = await Job.findById(app.jobId).lean();
  } catch (err) {
    console.log('[TRANSFORM] Could not fetch latest job:', err.message);
  }

  const contactVisibility = latestJob?.contactVisibility || { whatsapp: true, mobile: true };
  const whatsappContactEnabled = latestJob?.whatsappContactEnabled !== false;

  const badge = getStatusBadge(app.status);
  const milestones = buildMilestones(app);

  const hrName = latestJob?.contactPerson?.name || app.jobHrName || 'HR Team';
  const hrRole = latestJob?.contactPerson?.designation || app.jobHrRole || 'Recruiter';
  const hrPhone = latestJob?.recruiterMobileNumber || app.jobHrPhone || '';
  const hrWhatsapp = latestJob?.recruiterWhatsappNumber || app.jobHrWhatsapp || '';

  const phoneEnabled = contactVisibility.mobile !== false && !!hrPhone;
  const whatsappEnabled =
    contactVisibility.whatsapp !== false &&
    whatsappContactEnabled &&
    !!(hrWhatsapp || hrPhone);

  return {
    id: String(app._id),
    jobId: String(app.jobId),
    jobTitle: app.jobTitle,
    company: app.jobCompany,
    companyLogoBg: '#E0D4FC',
    companyLogoText: (app.jobCompany || 'C').charAt(0).toUpperCase(),
    companyLogoUrl: latestJob?.companyLogo?.url || app.jobCompanyLogo || '',
    salary: app.jobSalary,
    location: app.jobLocation,
    distance: '',
    category: badge.category,
    matchPercentage: app.matchPercentage,
    status: app.status,
    statusBadge: { text: badge.text, isHighlighted: badge.isHighlighted },
    milestones,
    hrContact: {
      name: hrName,
      role: hrRole,
      initials: getInitials(hrName),
      phone: hrPhone,
      whatsapp: hrWhatsapp || hrPhone,
      whatsappEnabled,
      phoneEnabled,
      expectedReply: 'Application received. Expected reply within 24h',
    },
    hrNotes: app.hrNotes || '',
    appliedAt: app.appliedAt,
    updatedAt: app.updatedAt,
  };
}

// ═══════════════════════════════════════════════════════════════
// POST /api/v1/applications — Apply to a job
// ═══════════════════════════════════════════════════════════════
exports.applyToJob = async (req, res) => {
  console.log('\n========== APPLY TO JOB REQUEST ==========');
  console.log('[APPLY] User ID from token:', req.user?.id);
  console.log('[APPLY] Request body:', JSON.stringify(req.body));

  try {
    const userId = req.user.id;
    const { jobId, coverNote } = req.body;

    if (!jobId) {
      return res.status(400).json({ success: false, message: 'Job ID is required' });
    }

    const job = await Job.findById(jobId);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

    if (job.status !== 'Live' || !job.isActive) {
      return res.status(400).json({ success: false, message: 'Job is no longer active' });
    }

    const existing = await Application.findOne({ jobId, userId });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'You have already applied for this job',
        alreadyApplied: true,
      });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!user.name || !user.phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Please complete your profile (name and phone) before applying',
        missingProfile: true,
      });
    }

    if (!user.resumeUrl) {
      return res.status(400).json({
        success: false,
        message: 'Please upload your resume before applying',
        missingResume: true,
      });
    }

    const matchPercentage = calculateMatch(job.skills || [], user.skills || []);

    const application = await Application.create({
      jobId,
      userId,
      candidateName: user.name || '',
      candidatePhone: user.phoneNumber || '',
      candidateEmail: user.email || '',
      candidateCity: user.city || '',
      candidateSubLocation: user.subLocation || '',
      candidateAvatarUrl: user.avatarUrl || '',
      resumeUrl: user.resumeUrl || '',
      resumeFileName: user.resumeFileName || 'Resume.pdf',
      candidateSkills: user.skills || [],
      candidateLanguages: user.knownLanguages || [],
      candidateEnglishLevel: user.englishLevel || '',
      candidateExperience: user.totalExperience || '',
      candidateExperienceLevel: user.experienceLevel || '',
      candidateJobTitle: user.jobTitle || '',
      candidateCurrentCompany: user.currentCompany || '',
      candidateCurrentSalary: user.currentSalary || '',
      candidateEducation: {
        collegeName: user.collegeName || '',
        degree: user.degree || '',
        specialization: user.specialization || '',
        endYear: user.endYear || '',
      },
      candidateAssets: user.assets || [],
      candidateCertifications: user.certifications || [],
      jobTitle: job.title || '',
      jobCompany: job.companyName || '',
      jobCompanyLogo: job.companyLogo?.url || '',
      jobSalary:
        job.salary?.min && job.salary?.max
          ? `Rs. ${job.salary.min}-${job.salary.max}`
          : 'Not disclosed',
      jobLocation: [job.location?.city, job.location?.state].filter(Boolean).join(', ') || '',
      jobHrName: job.contactPerson?.name || 'HR Team',
      jobHrRole: job.contactPerson?.designation || 'Recruiter',
      jobHrPhone: job.recruiterMobileNumber || '',
      jobHrWhatsapp: job.recruiterWhatsappNumber || '',
      matchPercentage,
      coverNote: coverNote || '',
      status: 'Applied',
      category: 'pending',
      milestones: [
        { title: 'Applied successfully', time: 'Today, Just now', completed: true, isHighlight: true },
        { title: 'Direct HR Review Scheduled', statusText: 'In Pipeline', completed: false },
      ],
      appliedAt: new Date(),
    });

    console.log('[APPLY] Application created! ID:', application._id);
    await Job.findByIdAndUpdate(jobId, { $inc: { applicantsCount: 1 } });

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      application: {
        id: application._id,
        jobId: application.jobId,
        status: application.status,
        matchPercentage: application.matchPercentage,
        appliedAt: application.appliedAt,
      },
    });
  } catch (error) {
    console.log('[APPLY] CRITICAL ERROR:', error.message);
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'You have already applied for this job',
        alreadyApplied: true,
      });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// GET /api/v1/applications/my
// ═══════════════════════════════════════════════════════════════
exports.getMyApplications = async (req, res) => {
  try {
    const userId = req.user.id;
    const applications = await Application.find({ userId }).sort({ appliedAt: -1 }).lean();

    const transformed = await Promise.all(applications.map((app) => transformApplication(app)));

    const counts = {
      all: transformed.length,
      pending: transformed.filter((a) => a.category === 'pending').length,
      'hr-responded': transformed.filter((a) => a.category === 'hr-responded').length,
      offers: transformed.filter((a) => a.category === 'offers').length,
    };

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    res.status(200).json({ success: true, applications: transformed, counts, timestamp: Date.now() });
  } catch (error) {
    console.log('[MY-APPS] ERROR:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// GET /api/v1/applications/:id
// ═══════════════════════════════════════════════════════════════
exports.getApplicationById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const app = await Application.findOne({ _id: id, userId }).lean();
    if (!app) return res.status(404).json({ success: false, message: 'Application not found' });

    const transformed = await transformApplication(app);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.status(200).json({ success: true, application: transformed, timestamp: Date.now() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// GET /api/v1/applications/check/:jobId
// ═══════════════════════════════════════════════════════════════
exports.checkApplied = async (req, res) => {
  try {
    const userId = req.user.id;
    const { jobId } = req.params;
    const existing = await Application.findOne({ jobId, userId }).lean();
    res.status(200).json({ success: true, applied: !!existing, application: existing || null });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// GET /api/v1/applications/debug
// ═══════════════════════════════════════════════════════════════
exports.debugApplications = async (req, res) => {
  try {
    const total = await Application.countDocuments({});
    const all = await Application.find({}).sort({ appliedAt: -1 }).limit(20).lean();
    res.status(200).json({
      success: true,
      total,
      applications: all.map((a) => ({
        id: a._id, user: a.userId, job: a.jobId, jobTitle: a.jobTitle,
        candidate: a.candidateName, status: a.status, appliedAt: a.appliedAt,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// DELETE /api/v1/applications/:id — Withdraw
// ═══════════════════════════════════════════════════════════════
exports.withdrawApplication = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const app = await Application.findOne({ _id: id, userId });
    if (!app) return res.status(404).json({ success: false, message: 'Application not found' });

    app.status = 'Withdrawn';
    app.category = 'expired';
    await app.save();

    await Job.findByIdAndUpdate(app.jobId, { $inc: { applicantsCount: -1 } });
    res.status(200).json({ success: true, message: 'Application withdrawn' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// 🚀 NEW: PATCH /api/v1/applications/:id/status
// Called by admin/recruiter to update application status
// → Automatically triggers push notification to candidate
// ═══════════════════════════════════════════════════════════════
exports.updateApplicationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, hrNotes } = req.body;

    const validStatuses = ['Applied', 'Viewed', 'Shortlisted', 'Interview', 'Offered', 'Hired', 'Rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const app = await Application.findById(id);
    if (!app) return res.status(404).json({ success: false, message: 'Application not found' });

    const previousStatus = app.status;
    if (previousStatus === status) {
      return res.status(200).json({ success: true, message: 'Status already set', unchanged: true });
    }

    // Update status + timestamp
    app.status = status;
    const badge = getStatusBadge(status);
    app.category = badge.category;

    const now = new Date();
    const timestampMap = {
      Viewed: 'viewedAt',
      Shortlisted: 'shortlistedAt',
      Interview: 'interviewAt',
      Offered: 'offeredAt',
      Hired: 'hiredAt',
    };
    if (timestampMap[status]) app[timestampMap[status]] = now;

    if (hrNotes !== undefined) app.hrNotes = hrNotes;

    await app.save();

    console.log(`[STATUS-UPDATE] ${previousStatus} → ${status} for application ${id}`);

    // 🚀 Fire push notification (non-blocking)
    sendStatusChangeNotification(app, status).catch((err) => {
      console.error('[STATUS-UPDATE] Notification error (non-blocking):', err.message);
    });

    res.status(200).json({
      success: true,
      message: `Status updated from ${previousStatus} to ${status}`,
      application: await transformApplication(app.toObject()),
    });
  } catch (error) {
    console.error('[STATUS-UPDATE] ERROR:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Export helper for use in other controllers (if needed)
exports._sendStatusChangeNotification = sendStatusChangeNotification;