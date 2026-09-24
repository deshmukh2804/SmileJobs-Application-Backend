const Banner = require('../models/Banner');
const { _helpers } = require('./homeController');
const { activeBannerFilter, transformBanner } = _helpers;

// GET /api/v1/banners?placement=home_hero
exports.listBanners = async (req, res) => {
  try {
    const placement = req.query.placement || 'home_hero';
    const banners = await Banner.find(activeBannerFilter(placement))
      .sort({ priority: -1, slot: 1, order: 1, createdAt: -1 })
      .lean();
    res.status(200).json({
      success: true,
      banners: banners.map(transformBanner),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/v1/banners/:id/impression
exports.trackImpression = async (req, res) => {
  try {
    await Banner.updateOne({ _id: req.params.id }, { $inc: { impressions: 1 } });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/v1/banners/:id/click
exports.trackClick = async (req, res) => {
  try {
    await Banner.updateOne(
      { _id: req.params.id },
      { $inc: { clicks: 1 }, $set: { lastClickedAt: new Date() } }
    );
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};