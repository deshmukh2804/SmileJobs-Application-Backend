// backend/utils/geoUtils.js

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

const LOCAL_COORDS = {
  'pune': { lat: 18.5204, lon: 73.8567 }, 'talegaon dabhade': { lat: 18.7358, lon: 73.6756 },
  'talegaon': { lat: 18.7358, lon: 73.6756 }, 'chinchwad': { lat: 18.6298, lon: 73.7997 },
  'hinjewadi': { lat: 18.5905, lon: 73.7376 }, 'wakad': { lat: 18.5975, lon: 73.7625 },
  'kharadi': { lat: 18.5515, lon: 73.9370 }, 'hadapsar': { lat: 18.5089, lon: 73.9260 },
  'baner': { lat: 18.5590, lon: 73.7868 }, 'kothrud': { lat: 18.5074, lon: 73.8077 },
  'pimpri': { lat: 18.6280, lon: 73.7997 }, 'mumbai': { lat: 19.0760, lon: 72.8777 },
  'andheri': { lat: 19.1197, lon: 72.8468 }, 'bengaluru': { lat: 12.9716, lon: 77.5946 },
  'bangalore': { lat: 12.9716, lon: 77.5946 }, 'hyderabad': { lat: 17.3850, lon: 78.4867 },
  'delhi': { lat: 28.6139, lon: 77.2090 }, 'delhi ncr': { lat: 28.6139, lon: 77.2090 },
  'noida': { lat: 28.5355, lon: 77.3910 }, 'gurugram': { lat: 28.4595, lon: 77.0266 },
  'chennai': { lat: 13.0827, lon: 80.2707 }, 'kolkata': { lat: 22.5726, lon: 88.3639 },
  'ahmedabad': { lat: 23.0225, lon: 72.5714 }, 'bhopal': { lat: 23.2599, lon: 77.4126 },
  'indore': { lat: 22.7196, lon: 75.8577 }, 'nagpur': { lat: 21.1458, lon: 79.0882 },
  'nashik': { lat: 19.9975, lon: 73.7898 }, 'surat': { lat: 21.1702, lon: 72.8311 },
  'aundh': { lat: 18.5590, lon: 73.8073 }, 'ravet': { lat: 18.6510, lon: 73.7526 },
  'nigdi': { lat: 18.6540, lon: 73.7686 }, 'viman nagar': { lat: 18.5679, lon: 73.9143 },
  'magarpatta': { lat: 18.5158, lon: 73.9268 }, 'koregaon park': { lat: 18.5364, lon: 73.8931 },
  'powai': { lat: 19.1197, lon: 72.9053 }, 'bandra': { lat: 19.0596, lon: 72.8295 },
  'goregaon': { lat: 19.1663, lon: 72.8526 }, 'thane': { lat: 19.2183, lon: 72.9781 },
  'navi mumbai': { lat: 19.0330, lon: 73.0297 }, 'whitefield': { lat: 12.9698, lon: 77.7500 },
  'koramangala': { lat: 12.9352, lon: 77.6245 }, 'gachibowli': { lat: 17.4401, lon: 78.3489 },
  'madhapur': { lat: 17.4483, lon: 78.3915 }, 'hitech city': { lat: 17.4435, lon: 78.3772 },
};

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getJobCoords(job) {
  const loc = job.location || {};
  if (loc.lat != null && loc.lon != null) {
    const lat = parseFloat(loc.lat);
    const lon = parseFloat(loc.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }
  const cityKey = (loc.city || '').toLowerCase().trim();
  if (cityKey && LOCAL_COORDS[cityKey]) return LOCAL_COORDS[cityKey];
  const addressKey = (loc.address || '').toLowerCase().trim();
  for (const [key, coords] of Object.entries(LOCAL_COORDS)) {
    if (addressKey.includes(key)) return coords;
  }
  return null;
}

function parsePagination(req) {
  if (!req || !req.query) {
    return { page: 1, limit: DEFAULT_LIMIT, skip: 0 };
  }
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT));
  return { page, limit, skip: (page - 1) * limit };
}

function parseCoords(req) {
  if (!req || !req.query) return null;
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  LOCAL_COORDS,
  distanceKm,
  getJobCoords,
  parseCoords,
  escapeRegex,
  parsePagination,
};