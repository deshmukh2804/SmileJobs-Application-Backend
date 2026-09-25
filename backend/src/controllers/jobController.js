const Job = require('../models/Job');
const { _helpers } = require('./homeController');
const { liveJobFilter, transformJobCard, transformJobDetail, JOB_CARD_PROJECTION } = _helpers;

const NEARBY_RADIUS_KM = 50;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

// Instant local coordinates for distance math fallback
const LOCAL_COORDS = {
  'pune': { lat: 18.5204, lon: 73.8567 },
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
  'mumbai': { lat: 19.0760, lon: 72.8777 },
  'andheri': { lat: 19.1197, lon: 72.8468 },
  'bengaluru': { lat: 12.9716, lon: 77.5946 },
  'bangalore': { lat: 12.9716, lon: 77.5946 },
  'hyderabad': { lat: 17.3850, lon: 78.4867 },
  'delhi': { lat: 28.6139, lon: 77.2090 },
  'delhi ncr': { lat: 28.6139, lon: 77.2090 },
  'noida': { lat: 28.5355, lon: 77.3910 },
  'gurugram': { lat: 28.4595, lon: 77.0266 },
  'chennai': { lat: 13.0827, lon: 80.2707 },
  'kolkata': { lat: 22.5726, lon: 88.3639 },
  'ahmedabad': { lat: 23.0225, lon: 72.5714 },
  'bhopal': { lat: 23.2599, lon: 77.4126 },
  'indore': { lat: 22.7196, lon: 75.8577 },
};

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parsePagination(req) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function parseCoords(req) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─────────────────────────────────────────────
// GET /api/v1/jobs
// ─────────────────────────────────────────────
exports.listJobs = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const filter = liveJobFilter();

    if (req.query.featured === 'true') filter.featured = true;
    if (req.query.isNew === 'true') filter.isNew = true;
    if (req.query.city) filter['location.city'] = new RegExp(escapeRegex(String(req.query.city).trim()), 'i');
    if (req.query.workMode) filter.workMode = req.query.workMode;
    if (req.query.jobType) filter.jobType = req.query.jobType;

    const [jobs, total] = await Promise.all([
      Job.find(filter, JOB_CARD_PROJECTION)
        .sort({ postedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Job.countDocuments(filter),
    ]);

    res.set('Cache-Control', 'private, max-age=20');
    res.status(200).json({
      success: true,
      jobs: jobs.map(transformJobCard),
      pagination: {
        page,
        limit,
        total,
        hasMore: skip + jobs.length < total,
        hasNextPage: skip + jobs.length < total,
      },
    });
  } catch (error) {
    console.error('[jobs.list] error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/jobs/search?q=...
// ─────────────────────────────────────────────
exports.searchJobs = async (req, res) => {
  try {
    const rawQ = (req.query.q || req.query.query || '').toString().trim();
    const { page, limit, skip } = parsePagination(req);
    const base = liveJobFilter();
    let filter = { ...base };

    if (rawQ) {
      const rx = new RegExp(escapeRegex(rawQ), 'i');
      filter = {
        ...base,
        $or: [
          { title: rx },
          { role: rx },
          { companyName: rx },
          { 'location.city': rx },
          { 'location.address': rx },
          { skills: rx },
          { department: rx },
          { industry: rx },
        ],
      };
    }

    if (req.query.city) filter['location.city'] = new RegExp(escapeRegex(String(req.query.city).trim()), 'i');

    const [jobs, total] = await Promise.all([
      Job.find(filter, JOB_CARD_PROJECTION)
        .sort({ postedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Job.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      query: rawQ,
      jobs: jobs.map(transformJobCard),
      pagination: {
        page,
        limit,
        total,
        hasMore: skip + jobs.length < total,
        hasNextPage: skip + jobs.length < total,
      },
    });
  } catch (error) {
    console.error('[jobs.search] error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/jobs/:id
// ─────────────────────────────────────────────
exports.getJobById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(400).json({ success: false, message: 'Invalid job ID' });
    }

    const job = await Job.findOne({ _id: id }).lean();
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    res.status(200).json({ success: true, job: transformJobDetail(job) });
  } catch (error) {
    console.error('[jobs.getById] error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/jobs/nearby
// Resilient: Tries $geoNear -> Fallback to all live jobs + distance calculation
// ─────────────────────────────────────────────
exports.getNearbyJobs = async (req, res) => {
  try {
    const coords = parseCoords(req);
    const { page, limit, skip } = parsePagination(req);
    const radiusKm = parseFloat(req.query.radius) || NEARBY_RADIUS_KM;
    const q = String(req.query.q || '').trim();

    const baseFilter = liveJobFilter();
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      baseFilter.$or = [{ title: rx }, { role: rx }, { companyName: rx }, { skills: rx }];
    }

    let jobs = [];
    let total = 0;

    // 1. Try $geoNear aggregation first
    if (coords) {
      try {
        const pipeline = [
          {
            $geoNear: {
              near: { type: 'Point', coordinates: [coords.lon, coords.lat] },
              distanceField: 'distanceMeters',
              maxDistance: radiusKm * 1000,
              spherical: true,
              key: 'location.geo',
              query: baseFilter,
            },
          },
          {
            $facet: {
              jobs: [{ $skip: skip }, { $limit: limit }],
              totalCount: [{ $count: 'count' }],
            },
          },
        ];

        const result = await Job.aggregate(pipeline).exec();
        jobs = result[0]?.jobs || [];
        total = result[0]?.totalCount?.[0]?.count || 0;
      } catch (geoErr) {
        // Geospatial index not yet ready or geo fields missing — continue to fallback
      }
    }

    // 2. Fallback: If geo query returned 0 jobs, fetch live jobs from Job_db directly!
    if (jobs.length === 0) {
      const allJobs = await Job.find(baseFilter, JOB_CARD_PROJECTION)
        .sort({ postedAt: -1, createdAt: -1 })
        .limit(100)
        .lean();

      total = allJobs.length;
      const paged = allJobs.slice(skip, skip + limit);

      jobs = paged.map((j) => {
        let km = 3.5; // default fallback distance
        if (coords) {
          const jLat = j.location?.lat || (j.location?.city && LOCAL_COORDS[j.location.city.toLowerCase()]?.lat);
          const jLon = j.location?.lon || (j.location?.city && LOCAL_COORDS[j.location.city.toLowerCase()]?.lon);
          if (jLat && jLon) {
            km = distanceKm(coords.lat, coords.lon, jLat, jLon);
          }
        }
        return {
          ...j,
          distanceMeters: km * 1000,
        };
      });
    }

    // Format distances cleanly for UI
    const transformed = jobs.map((j) => {
      const t = transformJobCard(j);
      if (j.distanceMeters != null) {
        const km = j.distanceMeters / 1000;
        t.distance = km < 1 ? `${Math.round(j.distanceMeters)}m` : `${km.toFixed(1)} km`;
        t._distanceKm = km;
      }
      return t;
    });

    res.status(200).json({
      success: true,
      jobs: transformed,
      pagination: {
        page,
        limit,
        total,
        hasMore: skip + jobs.length < total,
        hasNextPage: skip + jobs.length < total,
      },
      radiusKm,
    });
  } catch (error) {
    console.error('[jobs.nearby] error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/jobs/other
// ─────────────────────────────────────────────
exports.getOtherCityJobs = async (req, res) => {
  try {
    const coords = parseCoords(req);
    const { page, limit, skip } = parsePagination(req);
    const radiusKm = parseFloat(req.query.radius) || NEARBY_RADIUS_KM;
    const q = String(req.query.q || '').trim();

    const baseFilter = liveJobFilter();
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      baseFilter.$or = [{ title: rx }, { role: rx }, { companyName: rx }, { skills: rx }];
    }

    const [allJobs, total] = await Promise.all([
      Job.find(baseFilter, JOB_CARD_PROJECTION)
        .sort({ postedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Job.countDocuments(baseFilter),
    ]);

    const transformed = allJobs.map((j) => {
      const t = transformJobCard(j);
      if (coords) {
        const jLat = j.location?.lat || (j.location?.city && LOCAL_COORDS[j.location.city.toLowerCase()]?.lat);
        const jLon = j.location?.lon || (j.location?.city && LOCAL_COORDS[j.location.city.toLowerCase()]?.lon);
        if (jLat && jLon) {
          const km = distanceKm(coords.lat, coords.lon, jLat, jLon);
          t.distance = km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)} km`;
          t._distanceKm = km;
        }
      }
      return t;
    });

    res.status(200).json({
      success: true,
      jobs: transformed,
      pagination: {
        page,
        limit,
        total,
        hasMore: skip + allJobs.length < total,
        hasNextPage: skip + allJobs.length < total,
      },
    });
  } catch (error) {
    console.error('[jobs.other] error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/jobs/backfill-coords
// ─────────────────────────────────────────────
exports.backfillCoordinates = async (req, res) => {
  try {
    const jobs = await Job.find({
      'location.lat': { $ne: null },
      'location.lon': { $ne: null },
    }).limit(1000);

    let updated = 0;
    for (const job of jobs) {
      const lat = parseFloat(job.location.lat);
      const lon = parseFloat(job.location.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        job.location.geo = { type: 'Point', coordinates: [lon, lat] };
        await job.save();
        updated++;
      }
    }

    res.status(200).json({ success: true, updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};