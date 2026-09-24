const express = require('express');
const router = express.Router();
const {
  applyToJob,
  getMyApplications,
  checkApplied,
  debugApplications,
  withdrawApplication,
} = require('../controllers/applicationController');
const { protect } = require('../middleware/authMiddleware');

// Debug endpoint (no auth required for testing)
router.get('/debug', debugApplications);

// Protected endpoints
router.post('/', protect, applyToJob);
router.get('/my', protect, getMyApplications);
router.get('/check/:jobId', protect, checkApplied);
router.delete('/:id', protect, withdrawApplication);

module.exports = router;