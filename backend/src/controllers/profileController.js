const User = require('../models/User');
const cloudinary = require('../config/cloudinary');

const uniq = (arr) =>
  Array.isArray(arr) ? [...new Set(arr.filter(Boolean).map(String))] : [];

exports.getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-__v');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const data = user.toObject();
    data.skills = uniq(data.skills);
    data.knownLanguages = uniq(data.knownLanguages);
    data.assets = uniq(data.assets);
    data.certifications = uniq(data.certifications);

    console.log(`[Profile] ✅ GET profile: ${data.phoneNumber} (${data.name || 'no name'}) — ${data.profileCompletion || 0}%`);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[Profile] getMyProfile error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

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
      return res.status(404).json({ success: false, message: 'User not found' });
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
    data.skills = uniq(data.skills);
    data.knownLanguages = uniq(data.knownLanguages);
    data.assets = uniq(data.assets);
    data.certifications = uniq(data.certifications);

    console.log(`[Profile] ✅ PUT saved: ${data.phoneNumber} — ${data.profileCompletion || 0}%`);
    res.status(200).json({ success: true, message: 'Profile saved', data });
  } catch (error) {
    console.error('[Profile] updateMyProfile error:', error);
    res.status(500).json({ success: false, message: error.message });
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
      return res.status(400).json({ success: false, message: 'No image provided' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.avatarUrl = avatarUrl;
    await user.save();

    console.log('✅ Avatar Uploaded:', user.avatarUrl);

    res.status(200).json({
      success: true,
      message: 'Photo uploaded',
      data: {
        avatarUrl: user.avatarUrl,
        profileCompletion: user.profileCompletion,
      },
    });
  } catch (error) {
    console.error('Avatar error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.uploadResume = async (req, res) => {
  try {
    let resumeUrl = '';
    let resumeFileName = req.body.fileName || 'Resume.pdf';
    let resumePublicId = '';

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

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
      return res.status(400).json({ success: false, message: 'No file provided' });
    }

    user.resumeUrl = resumeUrl;
    user.resumeFileName = resumeFileName;
    user.resumePublicId = resumePublicId;
    await user.save();

    console.log('✅ Resume public URL:', user.resumeUrl);

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
    console.error('Resume error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAllProfiles = async (req, res) => {
  try {
    const users = await User.find({ role: 'job_seeker', isVisibleToRecruiters: true })
      .select('-__v')
      .sort({ profileCompletion: -1, updatedAt: -1 })
      .limit(50);

    res.status(200).json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};