const searchService = require('../services/searchService');
const { parseCoords, parsePagination } = require('../utils/geoUtils');

exports.searchJobs = async (req, res) => {
  try {
    const { page, limit } = parsePagination(req);
    const q = (req.query.q || '').toString().trim();
    const city = (req.query.city || '').toString().trim();
    const area = (req.query.area || '').toString().trim();
    const category = (req.query.category || '').toString().trim();
    const coords = parseCoords(req);
    const radiusKm = Math.min(500, parseFloat(req.query.radiusKm) || 50);

    const result = await searchService.searchJobs({
      q, city, area, category, coords, radiusKm, page, limit,
    });

    res.status(200).json({
      success: true,
      query: q,
      filters: { city, area, category, radiusKm: coords ? radiusKm : null },
      jobs: result.jobs,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('[search.jobs] error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPopularCategories = async (req, res) => {
  try {
    const limit = Math.min(20, parseInt(req.query.limit) || 8);
    const data = await searchService.getPopularCategories({ limit });
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('[search.categories] error:', error.message);
    res.status(500).json({ success: false, message: error.message, data: [] });
  }
};

exports.getSearchSuggestions = async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    const limit = Math.min(10, parseInt(req.query.limit) || 5);
    const suggestions = await searchService.getSearchSuggestions({ q, limit });
    res.status(200).json({ success: true, suggestions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message, suggestions: [] });
  }
};

exports.getAreasByCity = async (req, res) => {
  try {
    const city = (req.query.city || '').toString().trim();
    const areas = await searchService.getAreasByCity({ city });
    res.status(200).json({ success: true, areas });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message, areas: [] });
  }
};