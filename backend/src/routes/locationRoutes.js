const express = require('express');
const router = express.Router();
const {
  searchLocations,
  updateMyLocation,
  getMyLocation,
  getCities,
  getAreasForCity,
} = require('../controllers/locationController');
const { protect } = require('../middleware/authMiddleware');

router.get('/search', searchLocations);
router.get('/cities', getCities);                       // ✅ NEW
router.get('/cities/:cityName/areas', getAreasForCity);  // ✅ NEW
router.get('/me', protect, getMyLocation);
router.put('/me', protect, updateMyLocation);

module.exports = router;