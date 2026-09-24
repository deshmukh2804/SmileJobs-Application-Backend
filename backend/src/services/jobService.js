const Job = require('../models/Job');
const { geocodeCity, distanceKm } = require('./locationService');

// ── Simple Nominatim geocoder with caching ──
const geoCache = new Map();

async function geocodeJobLocation(job) {
  const loc = job.location || {};
  const address = loc.address || '';
  const city = loc.city || '';
  const state = loc.state || '';

  const query = [address, city, state, 'India'].filter(Boolean).join(', ');
  if (!query) return null;

  if (geoCache.has(query)) return geoCache.get(query);

  const geo = await geocodeCity(query);
  if (geo) {
    geoCache.set(query, geo);
    return geo;
  }

  // Fallback: try city + state only
  const fallback = [city, state, 'India'].filter(Boolean).join(', ');
  if (fallback && fallback !== query) {
    const geo2 = await geocodeCity(fallback);
    if (geo2) {
      geoCache.set(query, geo2);
      return geo2;
    }
  }
  return null;
}

// ── Normalize text for fuzzy matching (case + whitespace + special chars) ──
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Check if any word in query matches any field ──
function fuzzyMatch(job, queryWords) {
  if (!queryWords || queryWords.length === 0) return true;

  const searchable = [
    job.title,
    job.role,
    job.department,
    job.industry,
    job.companyName,
    job.jobDescription,
    job.qualification,
    job.workMode,
    job.jobType,
    job.location?.address,
    job.location?.city,
    job.location?.state,
    job.location?.country,
    ...(job.skills || []),
    ...(job.languages || []),
    ...(job.benefits || []),
  ]
    .filter(Boolean)
    .map(normalize)
    .join(' ');

  // ALL query words must match somewhere in searchable text
  return queryWords.every((qw) => searchable.includes(qw));
}

// ── PUBLIC: Fetch Nearby Jobs within radius ──
async function getNearbyJobs({ lat, lon, radiusKm = 50, page = 1, limit = 50, q = '' }) {
  const skip = (page - 1) * limit;
  const queryWords = normalize(q).split(' ').filter((w) => w.length >= 2);

  // Base filter: only active jobs
  const baseFilter = { status: 'Live', isActive: true };

  // Fetch generous batch to filter locally by geo + fuzzy
  const allJobs = await Job.find(baseFilter)
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();

  const enriched = [];
  for (const job of allJobs) {
    // Fuzzy text match (query words in title/city/address/skills/etc.)
    if (queryWords.length && !fuzzyMatch(job, queryWords)) continue;

    // Geocode job location
    const geo = await geocodeJobLocation(job);
    if (!geo) continue;

    const dist = distanceKm(lat, lon, geo.lat, geo.lon);
    if (dist <= radiusKm) {
      enriched.push({
        ...job,
        _distanceKm: dist,
        _coords: { lat: geo.lat, lon: geo.lon },
      });
    }
  }

  // Sort by distance
  enriched.sort((a, b) => a._distanceKm - b._distanceKm);

  const paginated = enriched.slice(skip, skip + limit);
  return {
    jobs: paginated,
    total: enriched.length,
    hasMore: skip + paginated.length < enriched.length,
  };
}

// ── PUBLIC: Fetch Other City Jobs (outside radius) ──
async function getOtherCityJobs({ lat, lon, radiusKm = 50, page = 1, limit = 50, q = '' }) {
  const skip = (page - 1) * limit;
  const queryWords = normalize(q).split(' ').filter((w) => w.length >= 2);

  const baseFilter = { status: 'Live', isActive: true };

  const allJobs = await Job.find(baseFilter)
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();

  const enriched = [];
  for (const job of allJobs) {
    if (queryWords.length && !fuzzyMatch(job, queryWords)) continue;

    const geo = await geocodeJobLocation(job);
    if (!geo) continue;

    const dist = distanceKm(lat, lon, geo.lat, geo.lon);
    if (dist > radiusKm) {
      enriched.push({
        ...job,
        _distanceKm: dist,
        _coords: { lat: geo.lat, lon: geo.lon },
      });
    }
  }

  enriched.sort((a, b) => a._distanceKm - b._distanceKm);

  const paginated = enriched.slice(skip, skip + limit);
  return {
    jobs: paginated,
    total: enriched.length,
    hasMore: skip + paginated.length < enriched.length,
  };
}

module.exports = { getNearbyJobs, getOtherCityJobs, geocodeJobLocation };