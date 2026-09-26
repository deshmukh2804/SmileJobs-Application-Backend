const User = require('../models/User');
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
    const user = await User.findById(req.user.id, PROFILE_PROJECTION).lean();
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    user.skills = uniq(user.skills);
    user.knownLanguages = uniq(user.knownLanguages);
    user.assets = uniq(user.assets);
    user.certifications = uniq(user.certifications);

    if (user.resumeUrl || user.resumePublicId) {
      user.resumeUrl = getResumeProxyUrl(user, req);
    }

    res.set('Cache-Control', 'private, max-age=30');
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    console.error('[profile.getMe] error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      code: 'PROFILE_FETCH_ERROR',
      requestId: req.id,
    });
  }
};

// ─────────────────────────────────────────────
// PUT /api/profile/me
// ─────────────────────────────────────────────
exports.updateMyProfile = async (req, res) => {
  try {
    // ✅ ADDED 'phoneNumber' AND 'phone' TO ALLOWED KEYS
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

    // 🔥 Explicitly handle phone number saving for both phoneNumber and phone fields
    if (req.body.phoneNumber || req.body.phone) {
      const phoneNumberVal = String(req.body.phoneNumber || req.body.phone).trim();
      user.phoneNumber = phoneNumberVal;
      user.phone = phoneNumberVal;
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

// ─────────────────────────────────────────────
// POST /api/profile/upload-avatar
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// POST /api/profile/upload-resume
// ─────────────────────────────────────────────
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

    console.log(`[ResumeUpload] ✅ Saved resume for ${user._id}: ${resumeUrl}`);

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

// ─────────────────────────────────────────────
// GET /api/profile/resume/view/:userId?
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// GET /api/profile/resume/download/:userId?
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// GET /api/profile/all (recruiter-facing list)
// ─────────────────────────────────────────────
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