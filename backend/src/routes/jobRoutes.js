const express = require('express');
const router = express.Router();
const jobController = require('../controllers/jobController');
const authMiddleware = require('../middleware/authMiddleware');

// ─────────────────────────────────────────────────────────────
// PUBLIC ENDPOINTS (No Auth required for browsing)
// ─────────────────────────────────────────────────────────────
router.get('/', jobController.listJobs);
router.get('/search', jobController.searchJobs);
router.get('/nearby', jobController.getNearbyJobs);
router.get('/other', jobController.getOtherCityJobs);

// ─────────────────────────────────────────────────────────────
// PROTECTED ENDPOINTS (Require active session token)
// ─────────────────────────────────────────────────────────────
router.get('/:id', authMiddleware, jobController.getJobById);

// Admin-only utility route (requires user role check)
router.get('/backfill-coords', authMiddleware, (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  next();
}, jobController.backfillCoordinates);

module.exports = router;