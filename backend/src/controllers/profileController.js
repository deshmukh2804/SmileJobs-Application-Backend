const User = require('../models/User');
const cloudinary = require('../config/cloudinary');

const uniq = (arr) =>
  Array.isArray(arr) ? [...new Set(arr.filter(Boolean).map(String))] : [];

// ─────────────────────────────────────────────
// PROFILE PROJECTION — only fields the mobile app needs
// Excludes: __v, fcmTokens (huge array), sensitive audit fields
// ─────────────────────────────────────────────
const PROFILE_PROJECTION = {
  __v: 0,
  fcmTokens: 0,          // never expose FCM tokens to client
};

// ─────────────────────────────────────────────
// GET /api/profile/me
// ✅ Uses projection to exclude fcmTokens (large array)
// ✅ Consistent error shape
// ✅ Cache headers
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

    // Normalize arrays
    user.skills = uniq(user.skills);
    user.knownLanguages = uniq(user.knownLanguages);
    user.assets = uniq(user.assets);
    user.certifications = uniq(user.certifications);

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
// ✅ Whitelist approach — no field pollution
// ✅ Returns projected user (no fcmTokens)
// ─────────────────────────────────────────────
exports.updateMyProfile = async (req, res) => {
  try {
    const allowed = [
      'name', 'email', 'gender', 'birthday', 'city', 'subLocation',
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

    // Return projected data (no fcmTokens, no __v)
    const data = user.toObject();
    delete data.__v;
    delete data.fcmTokens;
    data.skills = uniq(data.skills);
    data.knownLanguages = uniq(data.knownLanguages);
    data.assets = uniq(data.assets);
    data.certifications = uniq(data.certifications);

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

    // Cleanup old resume
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
        format: 'pdf',
      });

      resumeUrl = uploadRes.secure_url;
      if (!resumeUrl.toLowerCase().endsWith('.pdf')) {
        resumeUrl = `${resumeUrl}.pdf`;
      }
      resumeUrl = resumeUrl
        .replace(/\/fl_attachment:[^/]+\//g, '/')
        .replace(/\/fl_attachment\//g, '/');

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

    res.status(200).json({
      success: true,
      message: 'Resume uploaded',
      data: {
        resumeUrl: user.resumeUrl,
        resumeFileName: user.resumeFileName,
        profileCompletion: user.profileCompletion,
      },
    });
  } catch (error) {
    console.error('[profile.uploadResume] error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      code: 'RESUME_UPLOAD_ERROR',
      requestId: req.id,
    });
  }
};

// ─────────────────────────────────────────────
// GET /api/profile/all  (recruiter-facing list)
// ✅ Uses projection — lightweight cards, not full docs
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

    res.status(200).json({
      success: true,
      data: users,
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