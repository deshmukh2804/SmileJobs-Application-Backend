const express = require('express');
const router = express.Router();
const {
  applyToJob,
  getMyApplications,
  getApplicationById,
  checkApplied,
  debugApplications,
  withdrawApplication,
  updateApplicationStatus, // ✅ Added for status change & notifications
} = require('../controllers/applicationController');
const { protect } = require('../middleware/authMiddleware');

// Debug endpoint (no auth required for testing)
router.get('/debug', debugApplications);

// Protected endpoints
router.post('/', protect, applyToJob);
router.get('/my', protect, getMyApplications);
router.get('/check/:jobId', protect, checkApplied);
router.get('/:id', protect, getApplicationById); // ✅ Get single application
router.delete('/:id', protect, withdrawApplication);

// ✅ NEW: Admin/Recruiter route to update application status.
// Automatically triggers the detailed push notification to the candidate.
router.patch('/:id/status', updateApplicationStatus);

module.exports = router;