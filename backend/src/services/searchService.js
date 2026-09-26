// backend/services/searchService.js

const Job = require('../models/Job');
const { _helpers } = require('../controllers/homeController');
const { liveJobFilter, JOB_CARD_PROJECTION, transformJobCard } = _helpers;
const { distanceKm, getJobCoords, escapeRegex, LOCAL_COORDS } = require('../utils/geoUtils');

// ─── DYNAMIC CITY DETECTION FROM QUERY ───
// Detects if the user's search query contains any known city/area name.
// If yes → we skip GPS radius filtering so jobs from that city are returned.
function detectCityInQuery(query) {
  if (!query) return null;
  const lowerQuery = query.toLowerCase();
  const knownLocations = Object.keys(LOCAL_COORDS);
  
  for (const loc of knownLocations) {
    // Match full word boundaries to avoid false positives
    const regex = new RegExp(`\\b${loc}\\b`, 'i');
    if (regex.test(lowerQuery)) {
      return loc;
    }
  }
  return null;
}

async function searchJobs({ q, city, area, category, coords, radiusKm, page, limit }) {
  const skip = (page - 1) * limit;
  
  const filter = { ...liveJobFilter() };
  const andConditions = [];

  // ─── DETECT IF USER TYPED A CITY NAME IN THE QUERY ───
  const detectedCity = detectCityInQuery(q);
  const hasExplicitLocation = Boolean(city || area || detectedCity);

  // ─── INTELLIGENT WORD-TOKENIZED TEXT SEARCH ───
  // Splits "Nashik", "Baner Pune", "Software Developer Kharadi" etc.
  // Every word must match somewhere in title/role/skills/city/area/etc.
  if (q && q.trim()) {
    const words = q.trim().split(/\s+/).filter(w => w.length > 0);
    
    words.forEach(word => {
      const rx = new RegExp(escapeRegex(word), 'i');
      andConditions.push({
        $or: [
          { title: rx },
          { role: rx },
          { companyName: rx },
          { skills: rx },
          { category: rx },
          { department: rx },
          { 'location.city': rx },
          { 'location.address': rx },
          { 'location.state': rx },
          { 'location.subLocation': rx },
          { jobDescription: rx }
        ]
      });
    });
  }

  // ─── EXPLICIT CITY FILTER ───
  if (city && city.trim()) {
    andConditions.push({
      'location.city': new RegExp(escapeRegex(city.trim()), 'i')
    });
  }

  // ─── EXPLICIT AREA FILTER ───
  if (area && area.trim()) {
    const areaRx = new RegExp(escapeRegex(area.trim()), 'i');
    andConditions.push({
      $or: [
        { 'location.address': areaRx },
        { 'location.subLocation': areaRx },
        { 'location.city': areaRx }
      ]
    });
  }

  // ─── EXPLICIT CATEGORY FILTER ───
  if (category && category.trim()) {
    andConditions.push({
      category: new RegExp(`^${escapeRegex(category.trim())}$`, 'i')
    });
  }

  if (andConditions.length > 0) {
    filter.$and = andConditions;
  }

  // ─── SMART LOCATION LOGIC ───
  // If user has typed a city name OR explicitly selected a city/area,
  // we do NOT apply the GPS radius filter — the text/city match handles filtering.
  // Only apply GPS radius when no location was specified anywhere.
  const shouldApplyGpsRadius = coords && coords.lat != null && coords.lon != null && !hasExplicitLocation;

  if (shouldApplyGpsRadius) {
    const batchSize = Math.min(300, limit * 15);
    const allJobs = await Job.find(filter, JOB_CARD_PROJECTION)
      .sort({ postedAt: -1, createdAt: -1 })
      .limit(batchSize)
      .lean();

    const withDistance = [];
    for (const job of allJobs) {
      const jobCoords = getJobCoords(job);
      if (!jobCoords) {
        withDistance.push({ ...job, _realDistanceKm: null });
        continue;
      }
      const km = distanceKm(coords.lat, coords.lon, jobCoords.lat, jobCoords.lon);
      if (km <= radiusKm) {
        withDistance.push({ ...job, _realDistanceKm: km });
      }
    }

    withDistance.sort((a, b) => {
      if (a._realDistanceKm == null && b._realDistanceKm == null) return 0;
      if (a._realDistanceKm == null) return 1;
      if (b._realDistanceKm == null) return -1;
      return a._realDistanceKm - b._realDistanceKm;
    });

    const total = withDistance.length;
    const paged = withDistance.slice(skip, skip + limit);

    const transformed = paged.map((j) => {
      const t = transformJobCard(j);
      if (j._realDistanceKm != null) {
        const km = j._realDistanceKm;
        t.distance = km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)} km`;
        t._distanceKm = km;
      } else {
        t.distance = '';
        t._distanceKm = null;
      }
      return t;
    });

    return {
      jobs: transformed,
      pagination: { page, limit, total, hasMore: skip + paged.length < total },
    };
  }

  // ─── STANDARD PAGINATED MONGO QUERY (no GPS radius) ───
  // Runs when the user has typed a city/area OR when no coords were provided.
  // This ensures Nashik, Delhi, Mumbai, Kolkata, and ALL cities can be found.
  const [jobs, total] = await Promise.all([
    Job.find(filter, JOB_CARD_PROJECTION)
      .sort({ postedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Job.countDocuments(filter),
  ]);

  // Optionally add distance info for display if coords are available
  const transformed = jobs.map((j) => {
    const t = transformJobCard(j);
    if (coords && coords.lat != null && coords.lon != null) {
      const jobCoords = getJobCoords(j);
      if (jobCoords) {
        const km = distanceKm(coords.lat, coords.lon, jobCoords.lat, jobCoords.lon);
        t.distance = km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)} km`;
        t._distanceKm = km;
      }
    }
    return t;
  });

  return {
    jobs: transformed,
    pagination: { page, limit, total, hasMore: skip + jobs.length < total },
  };
}

async function getPopularCategories({ limit = 8 }) {
  const pipeline = [
    { $match: liveJobFilter() },
    {
      $group: {
        _id: {
          $toLower: {
            $trim: {
              input: { $ifNull: ['$category', { $ifNull: ['$role', ''] }] },
            },
          },
        },
        count: { $sum: 1 },
        displayName: { $first: { $ifNull: ['$category', '$role'] } },
      },
    },
    { $match: { _id: { $ne: null, $ne: '' } } },
    { $sort: { count: -1 } },
    { $limit: limit },
    { $project: { _id: 0, category: '$displayName', count: 1 } },
  ];

  const result = await Job.aggregate(pipeline);
  return result.filter((r) => r.category && r.count > 0);
}

// ─── ENHANCED SUGGESTIONS — INCLUDE CITIES + JOB TITLES ───
async function getSearchSuggestions({ q, limit = 8 }) {
  if (!q || q.trim().length < 2) return [];
  const rx = new RegExp(escapeRegex(q.trim()), 'i');

  const filter = {
    ...liveJobFilter(),
    $or: [
      { title: rx },
      { role: rx },
      { category: rx },
      { 'location.city': rx },
      { 'location.address': rx },
      { 'location.subLocation': rx },
      { companyName: rx },
      { skills: rx }
    ]
  };

  const results = await Job.find(filter, {
    title: 1,
    role: 1,
    category: 1,
    companyName: 1,
    'location.city': 1,
    'location.subLocation': 1,
    skills: 1
  })
    .limit(limit * 4)
    .lean();

  const suggestions = new Set();
  
  // Priority: city > job title > role > category > company > skills
  for (const j of results) {
    const cityName = j.location?.city;
    const subLoc = j.location?.subLocation;
    if (cityName && rx.test(cityName)) suggestions.add(cityName);
    if (subLoc && rx.test(subLoc)) suggestions.add(subLoc);
    if (suggestions.size >= limit) break;
  }
  
  for (const j of results) {
    if (j.title && rx.test(j.title)) suggestions.add(j.title);
    if (suggestions.size >= limit) break;
  }
  
  for (const j of results) {
    if (j.role && rx.test(j.role)) suggestions.add(j.role);
    if (j.category && rx.test(j.category)) suggestions.add(j.category);
    if (j.companyName && rx.test(j.companyName)) suggestions.add(j.companyName);
    if (suggestions.size >= limit) break;
  }
  
  for (const j of results) {
    if (Array.isArray(j.skills)) {
      for (const skill of j.skills) {
        if (skill && rx.test(skill)) suggestions.add(skill);
        if (suggestions.size >= limit) break;
      }
    }
    if (suggestions.size >= limit) break;
  }

  return Array.from(suggestions).slice(0, limit);
}

async function getAreasByCity({ city }) {
  if (!city || !city.trim()) return [];
  const filter = {
    ...liveJobFilter(),
    'location.city': new RegExp(escapeRegex(city.trim()), 'i')
  };

  const jobs = await Job.find(filter, {
    'location.address': 1,
    'location.subLocation': 1
  })
    .limit(500)
    .lean();

  const areas = new Set();
  for (const j of jobs) {
    const addr = j.location?.address?.trim();
    const sub = j.location?.subLocation?.trim();
    if (sub) areas.add(sub);
    else if (addr) {
      const first = addr.split(',')[0]?.trim();
      if (first && first.length > 2) areas.add(first);
    }
  }
  return Array.from(areas).sort();
}

// ─── NEW: GET ALL AVAILABLE CITIES (for front-end display) ───
async function getAvailableCities() {
  const pipeline = [
    { $match: liveJobFilter() },
    {
      $group: {
        _id: { $toLower: { $trim: { input: '$location.city' } } },
        count: { $sum: 1 },
        displayName: { $first: '$location.city' }
      }
    },
    { $match: { _id: { $ne: null, $ne: '' } } },
    { $sort: { count: -1 } },
    { $project: { _id: 0, city: '$displayName', count: 1 } }
  ];

  const result = await Job.aggregate(pipeline);
  return result.filter(r => r.city && r.count > 0);
}

module.exports = {
  searchJobs,
  getPopularCategories,
  getSearchSuggestions,
  getAreasByCity,
  getAvailableCities,
};