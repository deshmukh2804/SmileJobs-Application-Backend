// backend/routes/searchRoutes.js

const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');

router.get('/jobs', searchController.searchJobs);
router.get('/categories/popular', searchController.getPopularCategories);
router.get('/suggestions', searchController.getSearchSuggestions);
router.get('/areas', searchController.getAreasByCity);
router.get('/cities', searchController.getAvailableCities);

module.exports = router;