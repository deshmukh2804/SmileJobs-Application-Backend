const Application = require('../models/Application');
const Job = require('../models/Job');
const User = require('../models/User');

function calculateMatch(jobSkills, userSkills) {
  if (!jobSkills || !jobSkills.length) return 60;
  const jLower = jobSkills.map((s) => String(s).toLowerCase().trim());
  const uLower = userSkills.map((s) => String(s).toLowerCase().trim());
  const matched = jLower.filter((s) => uLower.includes(s)).length;
  return Math.round((matched / jLower.length) * 100);
}

// ─────────────────────────────────────────────
// POST /api/v1/applications
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// GET /api/v1/applications/my
// ─────────────────────────────────────────────
exports.getMyApplications = async (req, res) => {
  console.log('\n[MY-APPS] Fetching applications for user:', req.user?.id);

  try {
    const userId = req.user.id;

    const applications = await Application.find({ userId })
      .sort({ appliedAt: -1 })
      .lean();

    console.log('[MY-APPS] Found', applications.length, 'applications');

    const transformed = applications.map((app) => ({
      id: String(app._id),
      jobId: String(app.jobId),
      jobTitle: app.jobTitle,
      company: app.jobCompany,
      companyLogoBg: '#E0D4FC',
      companyLogoText: (app.jobCompany || 'C').charAt(0).toUpperCase(),
      companyLogoUrl: app.jobCompanyLogo || '',
      salary: app.jobSalary,
      location: app.jobLocation,
      distance: '',
      category: app.category,
      matchPercentage: app.matchPercentage,
      status: app.status,
      statusBadge: {
        text:
          app.status === 'Applied'
            ? 'Applied Successfully'
            : app.status === 'Viewed'
            ? 'HR Viewed'
            : app.status === 'Shortlisted'
            ? 'Shortlisted'
            : app.status === 'Interview'
            ? 'Interview Scheduled'
            : app.status === 'Offered'
            ? 'Offer Received'
            : app.status === 'Rejected'
            ? 'Not Selected'
            : 'In Pipeline',
        isHighlighted: ['Shortlisted', 'Interview', 'Offered'].includes(app.status),
      },
      milestones: app.milestones || [],
      hrContact: {
        name: app.jobHrName || 'HR Team',
        role: app.jobHrRole || 'Recruiter',
        initials: (app.jobHrName || 'HR')
          .split(' ')
          .map((s) => s[0])
          .slice(0, 2)
          .join('')
          .toUpperCase(),
        phone: app.jobHrPhone || '',
        whatsapp: app.jobHrWhatsapp || '',
        expectedReply: 'Application received. Expected reply within 24h',
      },
      appliedAt: app.appliedAt,
    }));

    const counts = {
      all: transformed.length,
      pending: transformed.filter((a) => a.category === 'pending').length,
      'hr-responded': transformed.filter((a) => a.category === 'hr-responded').length,
      offers: transformed.filter((a) => a.category === 'offers').length,
    };

    console.log('[MY-APPS] Counts:', JSON.stringify(counts));

    res.status(200).json({
      success: true,
      applications: transformed,
      counts,
    });
  } catch (error) {
    console.log('[MY-APPS] ERROR:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/applications/check/:jobId
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// GET /api/v1/applications/debug
// Debug endpoint to see ALL applications in DB
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// DELETE /api/v1/applications/:id
// ─────────────────────────────────────────────
exports.withdrawApplication = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const app = await Application.findOne({ _id: id, userId });
    if (!app) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    app.status = 'Withdrawn';
    await app.save();

    await Job.findByIdAndUpdate(app.jobId, { $inc: { applicantsCount: -1 } });

    res.status(200).json({ success: true, message: 'Application withdrawn' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};