const express = require('express');
const router = express.Router();
const {
  listJobs, searchJobs, getJobById,
  getNearbyJobs, getOtherCityJobs, backfillCoordinates,
} = require('../controllers/jobController');

router.get('/search', searchJobs);
router.get('/nearby', getNearbyJobs);
router.get('/other', getOtherCityJobs);
router.get('/backfill-coords', backfillCoordinates);
router.get('/:id', getJobById);
router.get('/', listJobs);

module.exports = router;