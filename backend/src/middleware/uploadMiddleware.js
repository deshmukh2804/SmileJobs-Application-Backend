const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

// ── AVATAR STORAGE ──
const avatarStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    return {
      folder: 'careerflow/avatars',
      resource_type: 'image',
      type: 'upload',
      access_mode: 'public',
      public_id: `avatar_${req.user?.id || 'user'}_${Date.now()}`,
      transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
      format: 'jpg',
    };
  },
});

// ── RESUME STORAGE (public raw PDF) ──
const resumeStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    return {
      folder: 'careerflow/resumes',
      resource_type: 'raw',        // ✅ public PDF
      type: 'upload',
      access_mode: 'public',
      public_id: `resume_${req.user?.id || 'user'}_${Date.now()}`,
      format: 'pdf',
    };
  },
});

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

const uploadResume = multer({
  storage: resumeStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (
      allowedTypes.includes(file.mimetype) ||
      (file.originalname && file.originalname.match(/\.(pdf|doc|docx)$/i))
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, and DOCX formats are allowed'), false);
    }
  },
});

module.exports = { uploadAvatar, uploadResume };