const express = require('express');
const router = express.Router();
const homeController = require('../controllers/homeController');

// Helper to safely resolve controller functions with fallbacks
const resolve = (...fnNames) => {
  for (const name of fnNames) {
    if (homeController && typeof homeController[name] === 'function') {
      return homeController[name];
    }
  }
  return (req, res) => res.status(200).json({ success: true, sections: [], bottomNav: { items: [] } });
};

const homeHandler = resolve('getHomeConfig', 'getHomeScreen', 'getHome', 'getHomeData', 'home');
const bottomNavHandler = resolve('getBottomNav', 'bottomNav', 'getNav');
const debugHandler = resolve('debugAppConfigs', 'debug');

// Routes (supports /home, /, /bottom-nav, etc.)
router.get('/home', homeHandler);
router.get('/', homeHandler);
router.get('/bottom-nav', bottomNavHandler);
router.get('/debug/appconfigs', debugHandler);

module.exports = router;