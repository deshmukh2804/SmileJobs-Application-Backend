const express = require('express');
const router = express.Router();
const { listBanners, trackImpression, trackClick } = require('../controllers/bannerController');

router.get('/', listBanners);
router.post('/:id/impression', trackImpression);
router.post('/:id/click', trackClick);

module.exports = router;