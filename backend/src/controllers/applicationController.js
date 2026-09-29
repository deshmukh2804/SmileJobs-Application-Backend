const Application = require('../models/Application');
const Job = require('../models/Job');
const User = require('../models/User');

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
// HELPER: Build dynamic milestones based on current status
// Reflects real-time progress from admin/recruiter panel
// ═══════════════════════════════════════════════════════════════
function buildMilestones(app) {
  const status = app.status;
  const isTerminal = ['Rejected', 'Withdrawn'].includes(status);

  // Base workflow stages
  const stages = [
    {
      key: 'Applied',
      title: 'Application Submitted',
      time: app.appliedAt ? formatDate(app.appliedAt) : 'Just now',
    },
    {
      key: 'Viewed',
      title: 'HR Viewed Your Profile',
      time: app.viewedAt ? formatDate(app.viewedAt) : null,
    },
    {
      key: 'Shortlisted',
      title: 'Shortlisted for Next Round',
      time: app.shortlistedAt ? formatDate(app.shortlistedAt) : null,
    },
    {
      key: 'Interview',
      title: 'Interview Scheduled',
      time: app.interviewAt ? formatDate(app.interviewAt) : null,
    },
    {
      key: 'Offered',
      title: 'Offer Extended',
      time: app.offeredAt ? formatDate(app.offeredAt) : null,
    },
    {
      key: 'Hired',
      title: 'Successfully Hired',
      time: app.hiredAt ? formatDate(app.hiredAt) : null,
    },
  ];

  const stageOrder = ['Applied', 'Viewed', 'Shortlisted', 'Interview', 'Offered', 'Hired'];
  const currentIndex = stageOrder.indexOf(status);

  // If rejected/withdrawn, mark only completed stages up to that point
  if (isTerminal) {
    const milestones = stages.map((stage, idx) => {
      const stageIdx = stageOrder.indexOf(stage.key);
      // Mark stages completed based on the timestamps
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

    // Add rejection/withdrawal milestone
    milestones.push({
      title: status === 'Rejected' ? 'Application Not Selected' : 'Application Withdrawn',
      time: app.updatedAt ? formatDate(app.updatedAt) : '',
      completed: true,
      statusText: '',
      isHighlight: false,
    });
    return milestones;
  }

  // Normal flow — mark stages up to and including current as completed
  return stages.map((stage, idx) => {
    const stageIdx = stageOrder.indexOf(stage.key);
    const isCompleted = stageIdx <= currentIndex;
    const isCurrent = stageIdx === currentIndex;

    return {
      title: stage.title,
      time: stage.time || (isCompleted ? '' : ''),
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

  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Extract initials from name
// ═══════════════════════════════════════════════════════════════
function getInitials(name) {
  if (!name) return 'HR';
  return String(name)
    .split(' ')
    .filter(Boolean)
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Transform application document to mobile-friendly format
// Fetches LATEST job data to reflect real-time recruiter settings
// ═══════════════════════════════════════════════════════════════
async function transformApplication(app) {
  // Fetch latest job data (to get real-time contact visibility settings)
  let latestJob = null;
  try {
    latestJob = await Job.findById(app.jobId).lean();
  } catch (err) {
    console.log('[TRANSFORM] Could not fetch latest job:', err.message);
  }

  // Determine contact visibility from LIVE job data (fallback to snapshot)
  const contactVisibility = latestJob?.contactVisibility || { whatsapp: true, mobile: true };
  const whatsappContactEnabled = latestJob?.whatsappContactEnabled !== false;

  // Get status badge & category (auto-computed based on current status)
  const badge = getStatusBadge(app.status);

  // Build dynamic milestones based on real-time status
  const milestones = buildMilestones(app);

  // Get latest HR contact info from job (in case recruiter updated it)
  const hrName = latestJob?.contactPerson?.name || app.jobHrName || 'HR Team';
  const hrRole = latestJob?.contactPerson?.designation || app.jobHrRole || 'Recruiter';
  const hrPhone = latestJob?.recruiterMobileNumber || app.jobHrPhone || '';
  const hrWhatsapp = latestJob?.recruiterWhatsappNumber || app.jobHrWhatsapp || '';

  // ✅ Contact permissions from LIVE job settings
  // Recruiter can toggle these anytime from their panel
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
    statusBadge: {
      text: badge.text,
      isHighlighted: badge.isHighlighted,
    },
    milestones,
    hrContact: {
      name: hrName,
      role: hrRole,
      initials: getInitials(hrName),
      phone: hrPhone,
      whatsapp: hrWhatsapp || hrPhone,
      whatsappEnabled,   // ✅ Real-time from job settings
      phoneEnabled,      // ✅ Real-time from job settings
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
      console.log('[APPLY] ERROR: No jobId in request body');
      return res.status(400).json({ success: false, message: 'Job ID is required' });
    }

    // Step 1: Find the job
    console.log('[APPLY] Looking for job:', jobId);
    const job = await Job.findById(jobId);
    if (!job) {
      console.log('[APPLY] ERROR: Job not found in DB');
      return res.status(404).json({ success: false, message: 'Job not found' });
    }
    console.log('[APPLY] Job found:', job.title, 'at', job.companyName);
    console.log('[APPLY] Job status:', job.status, 'isActive:', job.isActive);

    if (job.status !== 'Live' || !job.isActive) {
      console.log('[APPLY] ERROR: Job is not live');
      return res.status(400).json({ success: false, message: 'Job is no longer active' });
    }

    // Step 2: Check duplicate
    const existing = await Application.findOne({ jobId, userId });
    if (existing) {
      console.log('[APPLY] User already applied. Application ID:', existing._id);
      return res.status(409).json({
        success: false,
        message: 'You have already applied for this job',
        alreadyApplied: true,
      });
    }

    // Step 3: Fetch user profile
    console.log('[APPLY] Fetching user profile for:', userId);
    const user = await User.findById(userId);
    if (!user) {
      console.log('[APPLY] ERROR: User not found in DB');
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    console.log('[APPLY] User found:', user.name, user.phoneNumber);
    console.log('[APPLY] User skills:', user.skills);
    console.log('[APPLY] User resume:', user.resumeUrl ? 'YES' : 'NO');

    // Step 4: Validate profile
    if (!user.name || !user.phoneNumber) {
      console.log('[APPLY] ERROR: Incomplete profile');
      return res.status(400).json({
        success: false,
        message: 'Please complete your profile (name and phone) before applying',
        missingProfile: true,
      });
    }

    if (!user.resumeUrl) {
      console.log('[APPLY] ERROR: No resume uploaded');
      return res.status(400).json({
        success: false,
        message: 'Please upload your resume before applying',
        missingResume: true,
      });
    }

    // Step 5: Calculate match
    const matchPercentage = calculateMatch(job.skills || [], user.skills || []);
    console.log('[APPLY] Match percentage:', matchPercentage);

    // Step 6: Create application
    console.log('[APPLY] Creating application document...');
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
        {
          title: 'Applied successfully',
          time: 'Today, Just now',
          completed: true,
          isHighlight: true,
        },
        {
          title: 'Direct HR Review Scheduled',
          statusText: 'In Pipeline',
          completed: false,
        },
      ],
      appliedAt: new Date(),
    });

    console.log('[APPLY] Application created successfully! ID:', application._id);

    // Step 7: Increment applicants count
    await Job.findByIdAndUpdate(jobId, { $inc: { applicantsCount: 1 } });
    console.log('[APPLY] Job applicants count incremented');

    // Step 8: Verify it was saved
    const verify = await Application.findById(application._id);
    console.log('[APPLY] Verification - saved in DB:', verify ? 'YES' : 'NO');
    console.log('==========================================\n');

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
    console.log('[APPLY] Error stack:', error.stack);
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
// GET /api/v1/applications/my — Get my applications
// ✅ NOW SYNCS WITH ADMIN/RECRUITER STATUS CHANGES IN REAL-TIME
// ═══════════════════════════════════════════════════════════════
exports.getMyApplications = async (req, res) => {
  console.log('\n[MY-APPS] Fetching applications for user:', req.user?.id);

  try {
    const userId = req.user.id;

    // Fetch FRESH data from DB (no cache) — this ensures admin/recruiter
    // status changes appear immediately on next fetch
    const applications = await Application.find({ userId })
      .sort({ appliedAt: -1 })
      .lean();

    console.log('[MY-APPS] Found', applications.length, 'applications');

    // Transform each application (fetches latest job data for real-time contact settings)
    const transformed = await Promise.all(
      applications.map((app) => transformApplication(app))
    );

    // Recompute counts based on latest categories (auto-updated by status)
    const counts = {
      all: transformed.length,
      pending: transformed.filter((a) => a.category === 'pending').length,
      'hr-responded': transformed.filter((a) => a.category === 'hr-responded').length,
      offers: transformed.filter((a) => a.category === 'offers').length,
    };

    console.log('[MY-APPS] Counts:', JSON.stringify(counts));

    // Send with cache-control headers to prevent stale data
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    res.status(200).json({
      success: true,
      applications: transformed,
      counts,
      timestamp: Date.now(), // helps client detect fresh data
    });
  } catch (error) {
    console.log('[MY-APPS] ERROR:', error.message);
    console.log('[MY-APPS] Stack:', error.stack);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// GET /api/v1/applications/:id — Get single application (with latest status)
// ═══════════════════════════════════════════════════════════════
exports.getApplicationById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const app = await Application.findOne({ _id: id, userId }).lean();
    if (!app) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    const transformed = await transformApplication(app);

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.status(200).json({
      success: true,
      application: transformed,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.log('[GET-APP] ERROR:', error.message);
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

    res.status(200).json({
      success: true,
      applied: !!existing,
      application: existing || null,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// GET /api/v1/applications/debug — Debug (dev use only)
// ═══════════════════════════════════════════════════════════════
exports.debugApplications = async (req, res) => {
  try {
    const total = await Application.countDocuments({});
    const all = await Application.find({}).sort({ appliedAt: -1 }).limit(20).lean();

    console.log('[DEBUG] Total applications in DB:', total);

    res.status(200).json({
      success: true,
      total,
      applications: all.map((a) => ({
        id: a._id,
        user: a.userId,
        job: a.jobId,
        jobTitle: a.jobTitle,
        candidate: a.candidateName,
        status: a.status,
        appliedAt: a.appliedAt,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ═══════════════════════════════════════════════════════════════
// DELETE /api/v1/applications/:id — Withdraw application
// ═══════════════════════════════════════════════════════════════
exports.withdrawApplication = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const app = await Application.findOne({ _id: id, userId });
    if (!app) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    app.status = 'Withdrawn';
    app.category = 'expired';
    await app.save();

    await Job.findByIdAndUpdate(app.jobId, { $inc: { applicantsCount: -1 } });

    res.status(200).json({ success: true, message: 'Application withdrawn' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};