const express = require('express');
const router = express.Router();
const { getHomeConfig, getBottomNav, debugAppConfigs } = require('../controllers/homeController');

router.get('/home', getHomeConfig);
router.get('/bottom-nav', getBottomNav);
router.get('/debug/appconfigs', debugAppConfigs);

module.exports = router;