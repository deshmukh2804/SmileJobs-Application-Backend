// backend/services/searchService.js

const Job = require('../models/Job');
const { _helpers } = require('../controllers/homeController');
const { liveJobFilter, JOB_CARD_PROJECTION, transformJobCard } = _helpers;
const { distanceKm, getJobCoords, escapeRegex } = require('../utils/geoUtils');

async function searchJobs({ q, city, area, category, coords, radiusKm, page, limit }) {
  const skip = (page - 1) * limit;
  
  // Start with the default live job filtering rules
  const filter = { ...liveJobFilter() };
  const andConditions = [];

  // ─── INTELLIGENT WORD-TOKENIZED TEXT SEARCH ───
  // Splits multi-word queries (e.g. "Baner Pune", "Kharadi Developer") 
  // and ensures every term matches somewhere in the document fields or location object.
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
          { 'location.subLocation': rx }
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
        { 'location.subLocation': areaRx }
      ]
    });
  }

  // ─── EXPLICIT CATEGORY FILTER ───
  if (category && category.trim()) {
    andConditions.push({
      category: new RegExp(`^${escapeRegex(category.trim())}$`, 'i')
    });
  }

  // Apply consolidated list of terms if any filters are active
  if (andConditions.length > 0) {
    filter.$and = andConditions;
  }

  // ─── GEOGRAPHIC COORDINATE RADIUS SELECTION ───
  if (coords && coords.lat != null && coords.lon != null) {
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

    // Sort closest jobs first
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

  // ─── DIRECT MONGODB DATA RETRIEVAL ───
  const [jobs, total] = await Promise.all([
    Job.find(filter, JOB_CARD_PROJECTION)
      .sort({ postedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Job.countDocuments(filter),
  ]);

  return {
    jobs: jobs.map(transformJobCard),
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

async function getSearchSuggestions({ q, limit = 5 }) {
  if (!q || q.trim().length < 2) return [];
  const rx = new RegExp(escapeRegex(q.trim()), 'i');
  const filter = { ...liveJobFilter(), $or: [{ title: rx }, { role: rx }, { category: rx }] };

  const results = await Job.find(filter, { title: 1, role: 1, category: 1 })
    .limit(limit * 3)
    .lean();

  const suggestions = new Set();
  for (const j of results) {
    if (j.title && rx.test(j.title)) suggestions.add(j.title);
    if (j.role && rx.test(j.role)) suggestions.add(j.role);
    if (j.category && rx.test(j.category)) suggestions.add(j.category);
    if (suggestions.size >= limit) break;
  }
  return Array.from(suggestions).slice(0, limit);
}

async function getAreasByCity({ city }) {
  if (!city || !city.trim()) return [];
  const filter = { ...liveJobFilter(), 'location.city': new RegExp(escapeRegex(city.trim()), 'i') };

  const jobs = await Job.find(filter, { 'location.address': 1, 'location.subLocation': 1 })
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

module.exports = {
  searchJobs,
  getPopularCategories,
  getSearchSuggestions,
  getAreasByCity,
};