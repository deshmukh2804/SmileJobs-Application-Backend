const User = require('../models/User');
const Profile = require('../models/Profile');
const { geocodeCity, searchLocations, getCities, getAreasForCity } = require('../services/locationService');
const { emitToUser } = require('../socketService');

// ─────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────
function validCoords(lat, lon) {
  const la = parseFloat(lat);
  const lo = parseFloat(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  return { lat: la, lon: lo };
}

// ─────────────────────────────────────────────
// GET /api/v1/locations/search?q=xxx
// ─────────────────────────────────────────────
exports.searchLocations = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.status(200).json({ success: true, results: [] });
    }

    const results = await searchLocations(q, 10);
    // Longer cache — search results are stable
    res.set('Cache-Control', 'public, max-age=300');
    res.status(200).json({ success: true, results });
  } catch (error) {
    console.error('[locations.search] error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      code: 'LOCATION_SEARCH_ERROR',
      requestId: req.id,
    });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/locations/cities?q=xxx
// ─────────────────────────────────────────────
exports.getCities = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const cities = await getCities(q || null);
    // Cities change rarely → long cache
    res.set('Cache-Control', 'public, max-age=3600'); // 1 hour
    res.status(200).json({ success: true, cities });
  } catch (error) {
    console.error('[locations.getCities] error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      code: 'CITY_LIST_ERROR',
      requestId: req.id,
    });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/locations/cities/:cityName/areas
// ─────────────────────────────────────────────
exports.getAreasForCity = async (req, res) => {
  try {
    const cityName = String(req.params.cityName || '').trim();
    if (!cityName) {
      return res.status(400).json({
        success: false,
        message: 'City name is required',
        code: 'MISSING_CITY',
      });
    }

    const areas = await getAreasForCity(cityName);
    // Areas change rarely → long cache
    res.set('Cache-Control', 'public, max-age=3600');
    res.status(200).json({ success: true, areas });
  } catch (error) {
    console.error('[locations.getAreas] error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      code: 'AREA_LIST_ERROR',
      requestId: req.id,
    });
  }
};

// ─────────────────────────────────────────────
// PUT /api/v1/locations/me
// ✅ Validates coords
// ✅ Sync Profile collection
// ✅ Emit socket event on success
// ─────────────────────────────────────────────
exports.updateMyLocation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { city, subLocation, state, country, lat, lon, source } = req.body;

    if (!city || typeof city !== 'string' || city.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'City is required',
        code: 'MISSING_CITY',
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    // Try coords from body first (already validated)
    let finalCoords = validCoords(lat, lon);

    // If body coords invalid/missing, geocode
    if (!finalCoords) {
      const geo = await geocodeCity(subLocation ? `${subLocation}, ${city}` : city);
      if (geo) {
        finalCoords = { lat: geo.lat, lon: geo.lon };
      }
    }

    // Update canonical user fields
    user.city = city.trim();
    user.subLocation = (subLocation || '').trim();
    user.state = state || user.state || '';
    user.country = country || 'India';
    user.lat = finalCoords?.lat ?? null;
    user.lon = finalCoords?.lon ?? null;
    user.locationSource = source || 'manual';
    user.locationUpdatedAt = new Date();

    await user.save();

    // Sync Profile collection (best-effort — do not block on failure)
    try {
      await Profile.findOneAndUpdate(
        { userId },
        { city: user.city, subLocation: user.subLocation },
        { upsert: false }
      );
    } catch (profileErr) {
      console.warn('[locations.updateMe] Profile sync failed (non-fatal):', profileErr.message);
    }

    // Emit socket event so multi-device sessions stay in sync
    try {
      emitToUser(userId, 'location:updated', {
        city: user.city,
        subLocation: user.subLocation,
        lat: user.lat,
        lon: user.lon,
        updatedAt: user.locationUpdatedAt,
      });
    } catch (sockErr) {
      // Non-fatal
    }

    res.status(200).json({
      success: true,
      message: 'Location updated',
      location: {
        city: user.city,
        subLocation: user.subLocation,
        state: user.state,
        country: user.country,
        lat: user.lat,
        lon: user.lon,
        source: user.locationSource,
        updatedAt: user.locationUpdatedAt,
      },
    });
  } catch (error) {
    console.error('[locations.updateMe] error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      code: 'LOCATION_UPDATE_ERROR',
      requestId: req.id,
    });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/locations/me
// ✅ Projection — only location fields
// ─────────────────────────────────────────────
exports.getMyLocation = async (req, res) => {
  try {
    const user = await User.findById(
      req.user.id,
      'city subLocation state country lat lon locationSource locationUpdatedAt'
    ).lean();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    res.set('Cache-Control', 'private, max-age=30');
    res.status(200).json({
      success: true,
      location: {
        city: user.city || '',
        subLocation: user.subLocation || '',
        state: user.state || '',
        country: user.country || 'India',
        lat: user.lat,
        lon: user.lon,
        source: user.locationSource || '',
        updatedAt: user.locationUpdatedAt,
      },
    });
  } catch (error) {
    console.error('[locations.getMe] error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      code: 'LOCATION_FETCH_ERROR',
      requestId: req.id,
    });
  }
};