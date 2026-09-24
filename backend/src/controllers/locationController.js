const User = require('../models/User');
const Profile = require('../models/Profile');
const { geocodeCity, searchLocations, getCities, getAreasForCity } = require('../services/locationService');
const { emitToUser } = require('../socketService');

// GET /api/v1/locations/search?q=xxx
exports.searchLocations = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.status(200).json({ success: true, results: [] });
    }
    const results = await searchLocations(q, 10);
    res.status(200).json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/locations/cities?q=xxx
exports.getCities = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const cities = await getCities(q || null);
    res.status(200).json({ success: true, cities });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/locations/cities/:cityName/areas
exports.getAreasForCity = async (req, res) => {
  try {
    const cityName = String(req.params.cityName || '').trim();
    if (!cityName) {
      return res.status(400).json({ success: false, message: 'City name is required' });
    }
    const areas = await getAreasForCity(cityName);
    res.status(200).json({ success: true, areas });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/v1/locations/me
exports.updateMyLocation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { city, subLocation, state, country, lat, lon, source } = req.body;

    if (!city) {
      return res.status(400).json({ success: false, message: 'City is required' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let finalLat = lat;
    let finalLon = lon;

    if (!finalLat || !finalLon) {
      const geo = await geocodeCity(subLocation ? `${subLocation}, ${city}` : city);
      if (geo) {
        finalLat = geo.lat;
        finalLon = geo.lon;
      }
    }

    // Update canonical user fields
    user.city = city;
    user.subLocation = subLocation || '';
    user.state = state || user.state || '';
    user.country = country || 'India';
    user.lat = finalLat || null;
    user.lon = finalLon || null;
    user.locationSource = source || 'manual';
    user.locationUpdatedAt = new Date();

    await user.save();

    // ✅ Sync with Profile collection to ensure profile data consistency (Rule 33)
    await Profile.findOneAndUpdate(
      { userId },
      { city: user.city, subLocation: user.subLocation },
      { upsert: false }
    );

    // ✅ SOCKET: notify all clients of the user's location change
    emitToUser(userId, 'location:updated', {
      city: user.city,
      subLocation: user.subLocation,
      lat: user.lat,
      lon: user.lon,
    });

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
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/locations/me
exports.getMyLocation = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      'city subLocation state country lat lon locationSource locationUpdatedAt'
    );
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

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
    res.status(500).json({ success: false, message: error.message });
  }
};