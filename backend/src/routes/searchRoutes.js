const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');

// PUBLIC endpoints — no auth required for browsing/searching
router.get('/jobs', searchController.searchJobs);
router.get('/categories/popular', searchController.getPopularCategories);
router.get('/suggestions', searchController.getSearchSuggestions);
router.get('/areas', searchController.getAreasByCity);

module.exports = router;