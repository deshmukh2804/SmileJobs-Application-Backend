const express = require('express');
const router = express.Router();
const {
  getMyProfile,
  updateMyProfile,
  uploadAvatar,
  uploadResume,
  getAllProfiles,
  viewResume,
  downloadResume,
} = require('../controllers/profileController');
const { protect, optionalAuth } = require('../middleware/authMiddleware');
const { uploadAvatar: avatarUp, uploadResume: resumeUp } = require('../middleware/uploadMiddleware');

router.get('/me', protect, getMyProfile);
router.put('/me', protect, updateMyProfile);
router.post('/upload-avatar', protect, avatarUp.single('avatar'), uploadAvatar);
router.post('/upload-resume', protect, resumeUp.single('resume'), uploadResume);
router.get('/all', protect, getAllProfiles);

// ✅ Resume View & Download Endpoints
router.get('/resume/view/:userId?', optionalAuth, viewResume);
router.get('/resume/download/:userId?', optionalAuth, downloadResume);

module.exports = router;