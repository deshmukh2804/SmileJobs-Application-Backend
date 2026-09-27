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
  getMyNotifications,
  getSavedJobs, // ✅ NEW
} = require('../controllers/profileController');
const { protect, optionalAuth } = require('../middleware/authMiddleware');
const { uploadAvatar: avatarUp, uploadResume: resumeUp } = require('../middleware/uploadMiddleware');

router.get('/me', protect, getMyProfile);
router.put('/me', protect, updateMyProfile);
router.get('/notifications', protect, getMyNotifications);

// ✅ NEW: Fetch all jobs saved/bookmarked by the current user
router.get('/saved-jobs', protect, getSavedJobs);

router.post('/upload-avatar', protect, avatarUp.single('avatar'), uploadAvatar);
router.post('/upload-resume', protect, resumeUp.single('resume'), uploadResume);
router.get('/all', protect, getAllProfiles);
router.get('/resume/view/:userId?', optionalAuth, viewResume);
router.get('/resume/download/:userId?', optionalAuth, downloadResume);

module.exports = router;