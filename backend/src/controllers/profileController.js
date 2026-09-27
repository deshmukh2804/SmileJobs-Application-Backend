const User = require('../models/User');
const Notification = require('../models/Notification');
const cloudinary = require('../config/cloudinary');

const uniq = (arr) =>
  Array.isArray(arr) ? [...new Set(arr.filter(Boolean).map(String))] : [];

const PROFILE_PROJECTION = {
  __v: 0,
  fcmTokens: 0,
};

function getBackendBaseUrl(req) {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL.replace(/\/+$/, '');
  if (process.env.API_URL) return process.env.API_URL.replace(/\/api\/?$/, '').replace(/\/+$/, '');
  const host = req ? req.get('host') : 'smilejobs-application-backend.onrender.com';
  const protocol = req && (req.protocol === 'https' || req.get('x-forwarded-proto') === 'https') ? 'https' : 'https';
  return `${protocol}://${host}`;
}

function getResumeProxyUrl(user, req) {
  if (!user || (!user.resumeUrl && !user.resumePublicId)) return '';
  const baseUrl = getBackendBaseUrl(req);
  return `${baseUrl}/api/profile/resume/view/${user._id || user.id}`;
}

// ─────────────────────────────────────────────
// GET /api/profile/me
// ─────────────────────────────────────────────
exports.getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(PROFILE_PROJECTION).lean();
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    if (user.resumeUrl || user.resumePublicId) {
      user.resumeUrl = getResumeProxyUrl(user, req);
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error('[profile.getMyProfile] error:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
      code: 'PROFILE_FETCH_ERROR',
    });
  }
};

// ─────────────────────────────────────────────
// GET /api/profile/notifications
// ─────────────────────────────────────────────
exports.getMyNotifications = async (req, res) => {
  try {
    const userId = req.user.id;

    console.log(`🔔 [Notifications] Fetching for user: ${userId}`);

    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found', data: [] });
    }

    const orConditions = [
      { targetAudience: 'all' },
      { targetAudience: { $in: ['candidates', 'job_seeker', 'job_seekers'] } },
      { targetUserIds: userId },
    ];

    if (user.city) {
      orConditions.push({
        targetAudience: 'city',
        targetCity: new RegExp(`^${user.city}$`, 'i')
      });
    }

    if (Array.isArray(user.skills) && user.skills.length > 0) {
      orConditions.push({
        targetAudience: 'skills',
        'filters.skills': { $in: user.skills }
      });
    }

    const notifications = await Notification.find({ $or: orConditions })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    res.status(200).json({
      success: true,
      count: notifications.length,
      data: notifications,
    });
  } catch (error) {
    console.error('[profile.getNotifications] error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      data: [],
    });
  }
};

// ─────────────────────────────────────────────
// ✅ NEW: GET /api/profile/saved-jobs
// Fetches all jobs saved/bookmarked by the current user.
// ─────────────────────────────────────────────
exports.getSavedJobs = async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`💾 [SavedJobs] Fetching for user: ${userId}`);

    // Try to lazy-load the Job model — it might live in the jobs microservice
    let Job;
    try {
      Job = require('../models/Job');
    } catch (_) {
      try {
        Job = require('../models/job');
      } catch (_) {
        try {
          Job = require('../../job-service/models/Job');
        } catch (_) {
          console.warn('⚠️ [SavedJobs] Job model not resolvable — returning empty array.');
          return res.status(200).json({
            success: true,
            count: 0,
            data: [],
          });
        }
      }
    }

    // Load user with saved-job identifiers (support multiple naming conventions)
    const user = await User.findById(userId)
      .select('savedJobs bookmarks bookmarkedJobs')
      .lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        data: [],
      });
    }

    // Merge and deduplicate all possible saved-job field names
    const savedJobIds = [
      ...(Array.isArray(user.savedJobs) ? user.savedJobs : []),
      ...(Array.isArray(user.bookmarks) ? user.bookmarks : []),
      ...(Array.isArray(user.bookmarkedJobs) ? user.bookmarkedJobs : []),
    ]
      .filter(Boolean)
      .map((id) => String(id));

    const uniqueIds = [...new Set(savedJobIds)];

    if (uniqueIds.length === 0) {
      console.log(`💾 [SavedJobs] No saved jobs for user ${userId}`);
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
      });
    }

    // Fetch full job documents by ID
    const jobs = await Job.find({ _id: { $in: uniqueIds } })
      .sort({ createdAt: -1 })
      .lean();

    // Enrich with `isSaved: true` (used by mobile UI)
    const enriched = jobs.map((j) => ({
      ...j,
      id: String(j._id),
      isSaved: true,
    }));

    console.log(`💾 [SavedJobs] Returned ${enriched.length} jobs`);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(200).json({
      success: true,
      count: enriched.length,
      data: enriched,
    });
  } catch (error) {
    console.error('[profile.getSavedJobs] error:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
      code: 'SAVED_JOBS_FETCH_ERROR',
      data: [],
    });
  }
};

exports.updateMyProfile = async (req, res) => {
  try {
    const allowed = [
      'name', 'phoneNumber', 'phone', 'email', 'gender', 'birthday', 'city', 'subLocation',
      'englishLevel', 'knownLanguages', 'aboutMe',
      'totalExperience', 'experienceLevel', 'workType', 'industry',
      'currentSalary', 'currentCompany', 'startDate', 'jobTitle',
      'skills', 'assets', 'collegeName', 'degree', 'endYear',
      'specialization', 'certifications', 'isVisibleToRecruiters',
    ];

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    if (req.body.phoneNumber || req.body.phone) {
      const phoneNumberVal = String(req.body.phoneNumber || req.body.phone).trim();
      if (phoneNumberVal) {
        user.phoneNumber = phoneNumberVal;
        user.phone = phoneNumberVal;
      }
    }

    allowed.forEach((key) => {
      if (req.body[key] === undefined) return;
      if (['skills', 'knownLanguages', 'assets', 'certifications'].includes(key)) {
        let val = req.body[key];
        if (typeof val === 'string') {
          val = val.split(',').map((s) => s.trim()).filter(Boolean);
        }
        user[key] = uniq(val);
      } else {
        user[key] = req.body[key];
      }
    });

    await user.save();

    const data = user.toObject();
    delete data.__v;
    delete data.fcmTokens;
    data.skills = uniq(data.skills);
    data.knownLanguages = uniq(data.knownLanguages);
    data.assets = uniq(data.assets);
    data.certifications = uniq(data.certifications);

    if (data.resumeUrl || data.resumePublicId) {
      data.resumeUrl = getResumeProxyUrl(data, req);
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.status(200).json({ success: true, message: 'Profile saved', data });
  } catch (error) {
    console.error('[profile.updateMe] error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      code: 'PROFILE_UPDATE_ERROR',
      requestId: req.id,
    });
  }
};

exports.uploadAvatar = async (req, res) => {
  try {
    let avatarUrl = '';

    if (req.file) {
      avatarUrl = req.file.path || req.file.secure_url;
    } else if (req.body.avatar || req.body.image || req.body.base64) {
      const fileStr = req.body.avatar || req.body.image || req.body.base64;
      const uploadRes = await cloudinary.uploader.upload(fileStr, {
        folder: 'careerflow/avatars',
        resource_type: 'image',
        type: 'upload',
        access_mode: 'public',
        overwrite: true,
        transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
        format: 'jpg',
      });
      avatarUrl = uploadRes.secure_url;
    } else {
      return res.status(400).json({
        success: false,
        message: 'No image provided',
        code: 'NO_IMAGE',
      });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    user.avatarUrl = avatarUrl;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Photo uploaded',
      data: {
        avatarUrl: user.avatarUrl,
        profileCompletion: user.profileCompletion,
      },
    });
  } catch (error) {
    console.error('[profile.uploadAvatar] error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      code: 'AVATAR_UPLOAD_ERROR',
      requestId: req.id,
    });
  }
};

exports.uploadResume = async (req, res) => {
  try {
    let resumeUrl = '';
    let resumeFileName = req.body.fileName || 'Resume.pdf';
    let resumePublicId = '';

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    if (user.resumePublicId) {
      try { await cloudinary.uploader.destroy(user.resumePublicId, { resource_type: 'raw' }); } catch (_) {}
      try { await cloudinary.uploader.destroy(user.resumePublicId, { resource_type: 'image' }); } catch (_) {}
      try { await cloudinary.uploader.destroy(user.resumePublicId, { resource_type: 'auto' }); } catch (_) {}
    }

    if (req.file) {
      resumeUrl = req.file.path || req.file.secure_url;
      resumeFileName = req.file.originalname || resumeFileName;
      resumePublicId = req.file.filename || req.file.public_id;
    } else if (req.body.resume || req.body.file || req.body.base64) {
      const fileStr = req.body.resume || req.body.file || req.body.base64;
      const publicId = `resume_${user._id}_${Date.now()}`;

      const uploadRes = await cloudinary.uploader.upload(fileStr, {
        folder: 'careerflow/resumes',
        resource_type: 'raw',
        type: 'upload',
        access_mode: 'public',
        public_id: publicId,
        overwrite: true,
      });

      resumeUrl = uploadRes.secure_url;
      resumePublicId = uploadRes.public_id;
    } else {
      return res.status(400).json({
        success: false,
        message: 'No file provided',
        code: 'NO_FILE',
      });
    }

    user.resumeUrl = resumeUrl;
    user.resumeFileName = resumeFileName;
    user.resumePublicId = resumePublicId;
    await user.save();

    const proxyViewUrl = getResumeProxyUrl(user, req);

    res.status(200).json({
      success: true,
      message: 'Resume uploaded successfully',
      data: {
        resumeUrl: proxyViewUrl,
        resumeFileName: user.resumeFileName,
        profileCompletion: user.profileCompletion,
      },
    });
  } catch (error) {
    console.error('[profile.uploadResume] error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Resume upload failed',
      code: 'RESUME_UPLOAD_ERROR',
      requestId: req.id,
    });
  }
};

exports.viewResume = async (req, res) => {
  try {
    const userId = req.params.userId || req.user?.id;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const user = await User.findById(userId).select('resumeUrl resumeFileName resumePublicId');
    if (!user || (!user.resumeUrl && !user.resumePublicId)) {
      return res.status(404).json({ success: false, message: 'Resume not found' });
    }

    const candidateUrls = [];

    if (user.resumePublicId) {
      try {
        const privateUrl = cloudinary.utils.private_download_url(user.resumePublicId, '', {
          resource_type: 'raw',
          type: 'upload',
          expires_at: Math.floor(Date.now() / 1000) + 7200,
        });
        if (privateUrl) candidateUrls.push(privateUrl);
      } catch (_) {}

      try {
        const signedUrl = cloudinary.url(user.resumePublicId, {
          resource_type: 'raw',
          type: 'upload',
          sign_url: true,
          secure: true,
        });
        if (signedUrl && !candidateUrls.includes(signedUrl)) candidateUrls.push(signedUrl);
      } catch (_) {}
    }

    if (user.resumeUrl) {
      candidateUrls.push(user.resumeUrl);
      if (user.resumeUrl.includes('/image/upload/')) {
        candidateUrls.push(user.resumeUrl.replace('/image/upload/', '/raw/upload/'));
      }
    }

    let pdfBuffer = null;
    let fetchedSuccessfully = false;

    for (const url of candidateUrls) {
      try {
        const fetchRes = await fetch(url);
        if (fetchRes.ok) {
          const ab = await fetchRes.arrayBuffer();
          pdfBuffer = Buffer.from(ab);
          if (pdfBuffer.slice(0, 4).toString() === '%PDF' || pdfBuffer.length > 100) {
            fetchedSuccessfully = true;
            break;
          }
        }
      } catch (e) {
        console.warn(`[viewResume] Failed fetching candidate URL: ${url}`, e.message);
      }
    }

    if (!fetchedSuccessfully || !pdfBuffer) {
      return res.status(404).json({
        success: false,
        message: 'Unable to retrieve resume PDF from storage.',
        code: 'RESUME_FETCH_FAILED',
      });
    }

    const fileName = (user.resumeFileName || 'Resume.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    return res.status(200).send(pdfBuffer);
  } catch (error) {
    console.error('[profile.viewResume] error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: error.message || 'Error streaming resume',
        code: 'RESUME_VIEW_ERROR',
      });
    }
  }
};

exports.downloadResume = async (req, res) => {
  try {
    const userId = req.params.userId || req.user?.id;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const user = await User.findById(userId).select('resumeUrl resumeFileName resumePublicId');
    if (!user || (!user.resumeUrl && !user.resumePublicId)) {
      return res.status(404).json({ success: false, message: 'Resume not found' });
    }

    const candidateUrls = [];
    if (user.resumePublicId) {
      try {
        const privateUrl = cloudinary.utils.private_download_url(user.resumePublicId, '', {
          resource_type: 'raw',
          type: 'upload',
          expires_at: Math.floor(Date.now() / 1000) + 7200,
        });
        if (privateUrl) candidateUrls.push(privateUrl);
      } catch (_) {}
    }
    if (user.resumeUrl) {
      candidateUrls.push(user.resumeUrl);
    }

    let pdfBuffer = null;
    for (const url of candidateUrls) {
      try {
        const fetchRes = await fetch(url);
        if (fetchRes.ok) {
          const ab = await fetchRes.arrayBuffer();
          pdfBuffer = Buffer.from(ab);
          break;
        }
      } catch (_) {}
    }

    if (!pdfBuffer) {
      return res.status(404).json({ success: false, message: 'Resume file not found' });
    }

    const fileName = (user.resumeFileName || 'Resume.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', pdfBuffer.length);

    return res.status(200).send(pdfBuffer);
  } catch (error) {
    console.error('[profile.downloadResume] error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAllProfiles = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const PROJECTION = {
      name: 1,
      avatarUrl: 1,
      city: 1,
      subLocation: 1,
      jobTitle: 1,
      currentCompany: 1,
      totalExperience: 1,
      experienceLevel: 1,
      skills: 1,
      profileCompletion: 1,
      updatedAt: 1,
    };

    const filter = { role: 'job_seeker', isVisibleToRecruiters: true };

    const [users, total] = await Promise.all([
      User.find(filter, PROJECTION)
        .sort({ profileCompletion: -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    const enrichedUsers = users.map(u => ({
      ...u,
      resumeUrl: getResumeProxyUrl(u, req),
    }));

    res.status(200).json({
      success: true,
      data: enrichedUsers,
      pagination: {
        page,
        limit,
        total,
        hasMore: skip + users.length < total,
      },
    });
  } catch (error) {
    console.error('[profile.getAll] error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      code: 'PROFILE_LIST_ERROR',
      requestId: req.id,
    });
  }
};