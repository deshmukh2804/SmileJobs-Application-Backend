// Keeping the file structure exactly as you requested with NO logic modifications:
const Job = require('../models/Job');
const { _helpers } = require('./homeController');
const { distanceKm, geocodeCity } = require('../services/locationService');
const { liveJobFilter, transformJob } = _helpers;

const NEARBY_RADIUS_KM = 50;

// ── Instant 0ms Local Coordinates Database (prevents network timeouts) ──
const LOCAL_COORDS = {
  // Cities
  'pune': { lat: 18.5204, lon: 73.8567 },
  'mumbai': { lat: 19.0760, lon: 72.8777 },
  'bengaluru': { lat: 12.9716, lon: 77.5946 },
  'bangalore': { lat: 12.9716, lon: 77.5946 },
  'hyderabad': { lat: 17.3850, lon: 78.4867 },
  'delhi': { lat: 28.6139, lon: 77.2090 },
  'delhi ncr': { lat: 28.6139, lon: 77.2090 },
  'noida': { lat: 28.5355, lon: 77.3910 },
  'gurugram': { lat: 28.4595, lon: 77.0266 },
  'gurgaon': { lat: 28.4595, lon: 77.0266 },
  'chennai': { lat: 13.0827, lon: 80.2707 },
  'kolkata': { lat: 22.5726, lon: 88.3639 },
  'ahmedabad': { lat: 23.0225, lon: 72.5714 },
  'jaipur': { lat: 26.9124, lon: 75.7873 },
  'lucknow': { lat: 26.8467, lon: 80.9462 },
  'bhopal': { lat: 23.2599, lon: 77.4126 },
  'indore': { lat: 22.7196, lon: 75.8577 },
  'nagpur': { lat: 21.1458, lon: 79.0882 },
  'nashik': { lat: 19.9975, lon: 73.7898 },
  'surat': { lat: 21.1702, lon: 72.8311 },
  'kochi': { lat: 9.9312, lon: 76.2673 },
  'chandigarh': { lat: 30.7333, lon: 76.7794 },
  'coimbatore': { lat: 11.0168, lon: 76.9558 },
  // Pune Areas
  'talegaon dabhade': { lat: 18.7358, lon: 73.6756 },
  'talegaon': { lat: 18.7358, lon: 73.6756 },
  'chinchwad': { lat: 18.6298, lon: 73.7997 },
  'hinjewadi': { lat: 18.5905, lon: 73.7376 },
  'wakad': { lat: 18.5975, lon: 73.7625 },
  'kharadi': { lat: 18.5515, lon: 73.9370 },
  'hadapsar': { lat: 18.5089, lon: 73.9260 },
  'baner': { lat: 18.5590, lon: 73.7868 },
  'kothrud': { lat: 18.5074, lon: 73.8077 },
  'pimpri': { lat: 18.6280, lon: 73.7997 },
  'aundh': { lat: 18.5590, lon: 73.8073 },
  'ravet': { lat: 18.6510, lon: 73.7526 },
  'nigdi': { lat: 18.6540, lon: 73.7686 },
  'viman nagar': { lat: 18.5679, lon: 73.9143 },
  'magarpatta': { lat: 18.5158, lon: 73.9268 },
  'koregaon park': { lat: 18.5364, lon: 73.8931 },
  // Mumbai Areas
  'andheri': { lat: 19.1197, lon: 72.8468 },
  'powai': { lat: 19.1197, lon: 72.9053 },
  'bandra': { lat: 19.0596, lon: 72.8295 },
  'goregaon': { lat: 19.1663, lon: 72.8526 },
  'dadar': { lat: 19.0176, lon: 72.8478 },
  'borivali': { lat: 19.2288, lon: 72.8567 },
  'malad': { lat: 19.1868, lon: 72.8484 },
  'kurla': { lat: 19.0728, lon: 72.8826 },
  'worli': { lat: 19.0176, lon: 72.8145 },
  'thane': { lat: 19.2183, lon: 72.9781 },
  'navi mumbai': { lat: 19.0330, lon: 73.0297 },
  // Bengaluru Areas
  'whitefield': { lat: 12.9698, lon: 77.7500 },
  'koramangala': { lat: 12.9352, lon: 77.6245 },
  'indiranagar': { lat: 12.9784, lon: 77.6408 },
  'hsr layout': { lat: 12.9116, lon: 77.6473 },
  'electronic city': { lat: 12.8452, lon: 77.6602 },
  // Hyderabad Areas
  'gachibowli': { lat: 17.4401, lon: 78.3489 },
  'madhapur': { lat: 17.4483, lon: 78.3915 },
  'hitech city': { lat: 17.4435, lon: 78.3772 },
};

// ── In-memory geocode cache ──
const geoCache = new Map();

function matchLocalCoordinate(text) {
  if (!text) return null;
  const clean = text.toLowerCase().trim();
  for (const [key, coords] of Object.entries(LOCAL_COORDS)) {
    if (clean.includes(key)) {
      return coords;
    }
  }
  return null;
}

async function geocodeJobLocation(job) {
  const loc = job.location || {};
  const address = loc.address || '';
  const city = loc.city || '';
  const state = loc.state || '';

  // 1. If job already has stored coords, use them directly (0ms)
  if (loc.lat != null && loc.lon != null) {
    return { lat: parseFloat(loc.lat), lon: parseFloat(loc.lon) };
  }

  // 2. Try instant local match on address/city/state (0ms - avoids network call!)
  const localMatch = matchLocalCoordinate(address) || matchLocalCoordinate(city) || matchLocalCoordinate(state);
  if (localMatch) {
    return localMatch;
  }

  // 3. Build query and check in-memory cache
  const query = [address, city, state, 'India'].filter(Boolean).join(', ');
  if (!query || query === 'India') return null;

  if (geoCache.has(query)) return geoCache.get(query);

  // 4. Try network geocoding only if cache and local DB missed
  try {
    const geo = await geocodeCity(query);
    if (geo) {
      geoCache.set(query, geo);
      return geo;
    }
    if (city) {
      const cityGeo = await geocodeCity(`${city}, India`);
      if (cityGeo) {
        geoCache.set(query, cityGeo);
        return cityGeo;
      }
    }
  } catch {}

  return null;
}

// ── Normalize text for fuzzy matching ──
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Check if ALL query words match ANY field in the job ──
function fuzzyMatchJob(job, queryWords) {
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
    job.noticePeriod,
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

  return queryWords.every((qw) => searchable.includes(qw));
}

// ─────────────────────────────────────────────
// GET /api/v1/jobs
// ─────────────────────────────────────────────
exports.listJobs = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const filter = liveJobFilter();

    if (req.query.featured === 'true') filter.featured = true;
    if (req.query.isNew === 'true') filter.isNew = true;
    if (req.query.city) filter['location.city'] = new RegExp(String(req.query.city).trim(), 'i');
    if (req.query.workMode) filter.workMode = req.query.workMode;
    if (req.query.jobType) filter.jobType = req.query.jobType;

    const [jobs, total] = await Promise.all([
      Job.find(filter).sort({ postedAt: -1 }).skip(skip).limit(limit).lean(),
      Job.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      jobs: jobs.map(transformJob),
      pagination: { page, limit, total, hasMore: skip + jobs.length < total },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/jobs/search?q=...
// ─────────────────────────────────────────────
exports.searchJobs = async (req, res) => {
  try {
    const rawQ = (req.query.q || req.query.query || '').toString().trim();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip = (page - 1) * limit;

    const base = liveJobFilter();
    let filter = base;

    if (rawQ) {
      const safe = rawQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(safe, 'i');
      filter = {
        ...base,
        $or: [
          { title: rx }, { role: rx }, { companyName: rx }, { department: rx },
          { industry: rx }, { jobType: rx }, { workMode: rx },
          { 'location.city': rx }, { 'location.state': rx }, { 'location.address': rx },
          { jobDescription: rx }, { qualification: rx }, { noticePeriod: rx },
          { skills: { $in: [rx] } }, { languages: { $in: [rx] } },
          { benefits: { $in: [rx] } },
        ],
      };
    }

    if (req.query.city) filter['location.city'] = new RegExp(String(req.query.city).trim(), 'i');
    if (req.query.workMode) filter.workMode = req.query.workMode;
    if (req.query.jobType) filter.jobType = req.query.jobType;

    const [jobs, total] = await Promise.all([
      Job.find(filter).sort({ postedAt: -1 }).skip(skip).limit(limit).lean(),
      Job.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true, query: rawQ,
      jobs: jobs.map(transformJob),
      pagination: { page, limit, total, hasMore: skip + jobs.length < total },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/jobs/:id
// ─────────────────────────────────────────────
exports.getJobById = async (req, res) => {
  try {
    const job = await Job.findOne({ _id: req.params.id, ...liveJobFilter() }).lean();
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    res.status(200).json({ success: true, job: transformJob(job) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/jobs/nearby?lat=&lon=&radius=50&page=&limit=&q=
// ─────────────────────────────────────────────
exports.getNearbyJobs = async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const radiusKm = parseFloat(req.query.radius) || NEARBY_RADIUS_KM;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;
    const q = String(req.query.q || '').trim();
    const queryWords = normalize(q).split(' ').filter((w) => w.length >= 2);

    if (!lat || !lon) {
      return res.status(400).json({ success: false, message: 'lat and lon required' });
    }

    const allJobs = await Job.find(liveJobFilter())
      .sort({ postedAt: -1 })
      .limit(500)
      .lean();

    const withDistance = [];

    for (const job of allJobs) {
      if (queryWords.length && !fuzzyMatchJob(job, queryWords)) continue;

      const geo = await geocodeJobLocation(job);
      if (!geo) {
        // If coordinate resolution fails, still include with fallback distance so jobs aren't lost
        withDistance.push({ ...job, _distanceKm: 5, _geoLat: lat, _geoLon: lon });
        continue;
      }

      const d = distanceKm(lat, lon, geo.lat, geo.lon);
      if (d <= radiusKm) {
        withDistance.push({ ...job, _distanceKm: d, _geoLat: geo.lat, _geoLon: geo.lon });
      }
    }

    withDistance.sort((a, b) => a._distanceKm - b._distanceKm);

    const total = withDistance.length;
    const paged = withDistance.slice(skip, skip + limit);

    const transformed = paged.map((j) => {
      const t = transformJob(j);
      const km = j._distanceKm || 0;
      t.distance = km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)} km`;
      t._distanceKm = km;
      return t;
    });

    res.status(200).json({
      success: true,
      jobs: transformed,
      pagination: { page, limit, total, hasMore: skip + paged.length < total },
      radiusKm,
    });
  } catch (error) {
    console.log('[NEARBY] Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/jobs/other?lat=&lon=&radius=50&page=&limit=&q=
// ─────────────────────────────────────────────
exports.getOtherCityJobs = async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    const radiusKm = parseFloat(req.query.radius) || NEARBY_RADIUS_KM;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;
    const q = String(req.query.q || '').trim();
    const queryWords = normalize(q).split(' ').filter((w) => w.length >= 2);

    if (!lat || !lon) {
      const baseFilter = liveJobFilter();
      const [jobs, total] = await Promise.all([
        Job.find(baseFilter).sort({ postedAt: -1 }).skip(skip).limit(limit).lean(),
        Job.countDocuments(baseFilter),
      ]);
      return res.status(200).json({
        success: true,
        jobs: jobs.map(transformJob),
        pagination: { page, limit, total, hasMore: skip + jobs.length < total },
      });
    }

    const allJobs = await Job.find(liveJobFilter())
      .sort({ postedAt: -1 })
      .limit(500)
      .lean();

    const outside = [];

    for (const job of allJobs) {
      if (queryWords.length && !fuzzyMatchJob(job, queryWords)) continue;

      const geo = await geocodeJobLocation(job);
      if (!geo) {
        outside.push({ ...job, _distanceKm: 9999 });
        continue;
      }

      const d = distanceKm(lat, lon, geo.lat, geo.lon);
      if (d > radiusKm) {
        outside.push({ ...job, _distanceKm: d, _geoLat: geo.lat, _geoLon: geo.lon });
      }
    }

    outside.sort((a, b) => a._distanceKm - b._distanceKm);

    const total = outside.length;
    const paged = outside.slice(skip, skip + limit);

    const transformed = paged.map((j) => {
      const t = transformJob(j);
      if (j._distanceKm && j._distanceKm < 9999) {
        const km = j._distanceKm;
        t.distance = km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)} km`;
      }
      t._distanceKm = j._distanceKm;
      return t;
    });

    res.status(200).json({
      success: true,
      jobs: transformed,
      pagination: { page, limit, total, hasMore: skip + paged.length < total },
    });
  } catch (error) {
    console.log('[OTHER] Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// Admin utility: backfill coordinates for existing jobs
// ─────────────────────────────────────────────
exports.backfillCoordinates = async (req, res) => {
  try {
    const jobs = await Job.find({
      $or: [
        { 'location.lat': null },
        { 'location.lat': { $exists: false } },
      ],
    });

    let updated = 0;
    let failed = 0;
    for (const job of jobs) {
      const loc = job.location || {};
      const query = [loc.address, loc.city, loc.state, 'India'].filter(Boolean).join(', ');
      if (!query || query === 'India') { failed++; continue; }

      const geo = await geocodeCity(query);
      if (geo) {
        job.location.lat = geo.lat;
        job.location.lon = geo.lon;
        await job.save();
        updated++;
      } else {
        if (loc.city) {
          const geo2 = await geocodeCity(`${loc.city}, India`);
          if (geo2) {
            job.location.lat = geo2.lat;
            job.location.lon = geo2.lon;
            await job.save();
            updated++;
            continue;
          }
        }
        failed++;
      }
      await new Promise((r) => setTimeout(r, 1100));
    }

    res.status(200).json({ success: true, total: jobs.length, updated, failed });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};