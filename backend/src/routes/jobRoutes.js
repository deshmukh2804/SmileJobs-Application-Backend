const express = require('express');
const router = express.Router();
const jobController = require('../controllers/jobController');
const authMiddleware = require('../middleware/authMiddleware');

// PUBLIC endpoints
router.get('/', jobController.listJobs);
router.get('/search', jobController.searchJobs);
router.get('/nearby', jobController.getNearbyJobs);
router.get('/other', jobController.getOtherCityJobs);

// ✅ SAVED JOBS routes — MUST be BEFORE /:id route
router.get('/saved', authMiddleware, jobController.getSavedJobs);
router.post('/:id/save', authMiddleware, jobController.saveJob);
router.delete('/:id/save', authMiddleware, jobController.unsaveJob);

// Protected route
router.get('/:id', authMiddleware, jobController.getJobById);

// Admin utility
router.get('/backfill-coords', authMiddleware, (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  next();
}, jobController.backfillCoordinates);

module.exports = router;