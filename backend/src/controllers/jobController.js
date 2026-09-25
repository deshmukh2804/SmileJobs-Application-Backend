const Job = require('../models/Job');
const { _helpers } = require('./homeController');
const { transformJobCard, transformJobDetail, JOB_CARD_PROJECTION } = _helpers;

const NEARBY_RADIUS_KM = 50;
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
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit) || DEFAULT_LIMIT));
  return { page, limit, skip: (page - 1) * limit };
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

exports.listJobs = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const filter = {};
    if (req.query.city) filter['location.city'] = new RegExp(escapeRegex(String(req.query.city).trim()), 'i');
    if (req.query.workMode) filter.workMode = req.query.workMode;
    if (req.query.jobType) filter.jobType = req.query.jobType;
    if (req.query.featured === 'true') filter.featured = true;

    const [jobs, total] = await Promise.all([
      Job.find(filter, JOB_CARD_PROJECTION).sort({ postedAt: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
      Job.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      jobs: jobs.map(transformJobCard),
      pagination: { page, limit, total, hasMore: skip + jobs.length < total },
    });
  } catch (error) {
    console.error('[jobs.list] error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.searchJobs = async (req, res) => {
  try {
    const rawQ = (req.query.q || '').toString().trim();
    const { page, limit, skip } = parsePagination(req);
    let filter = {};
    if (rawQ) {
      const rx = new RegExp(escapeRegex(rawQ), 'i');
      filter.$or = [{ title: rx }, { role: rx }, { companyName: rx }, { 'location.city': rx }, { skills: rx }];
    }
    const [jobs, total] = await Promise.all([
      Job.find(filter, JOB_CARD_PROJECTION).sort({ postedAt: -1 }).skip(skip).limit(limit).lean(),
      Job.countDocuments(filter),
    ]);
    res.status(200).json({
      success: true, query: rawQ, jobs: jobs.map(transformJobCard),
      pagination: { page, limit, total, hasMore: skip + jobs.length < total },
    });
  } catch (error) {
    console.error('[jobs.search] error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getJobById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-fA-F]{24}$/.test(id)) return res.status(400).json({ success: false, message: 'Invalid job ID' });
    const job = await Job.findById(id).lean();
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    res.status(200).json({ success: true, job: transformJobDetail(job) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getNearbyJobs = async (req, res) => {
  try {
    const coords = parseCoords(req);
    const { page, limit, skip } = parsePagination(req);
    const radiusKm = parseFloat(req.query.radius) || NEARBY_RADIUS_KM;
    const q = String(req.query.q || '').trim();

    let filter = {};
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ title: rx }, { role: rx }, { companyName: rx }, { skills: rx }];
    }

    // Fetch a batch of jobs to calculate real distances
    const batchSize = Math.min(200, limit * 10);
    const allJobs = await Job.find(filter, JOB_CARD_PROJECTION)
      .sort({ postedAt: -1, createdAt: -1 })
      .limit(batchSize)
      .lean();

    // Calculate REAL distance for each job
    const withDistance = [];
    for (const job of allJobs) {
      const jobCoords = getJobCoords(job);
      if (!jobCoords && !coords) {
        withDistance.push({ ...job, _realDistanceKm: null });
        continue;
      }
      if (!coords) {
        withDistance.push({ ...job, _realDistanceKm: null });
        continue;
      }
      if (!jobCoords) {
        withDistance.push({ ...job, _realDistanceKm: null });
        continue;
      }
      const km = distanceKm(coords.lat, coords.lon, jobCoords.lat, jobCoords.lon);
      if (km <= radiusKm) {
        withDistance.push({ ...job, _realDistanceKm: km });
      }
    }

    // Sort by distance (closest first)
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
        if (km < 1) {
          t.distance = `${Math.round(km * 1000)}m`;
        } else {
          t.distance = `${km.toFixed(1)} km`;
        }
        t._distanceKm = km;
      } else {
        t.distance = '';
        t._distanceKm = null;
      }
      return t;
    });

    res.status(200).json({
      success: true,
      jobs: transformed,
      pagination: { page, limit, total, hasMore: skip + paged.length < total },
      radiusKm,
    });
  } catch (error) {
    console.error('[jobs.nearby] error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getOtherCityJobs = async (req, res) => {
  try {
    const coords = parseCoords(req);
    const { page, limit, skip } = parsePagination(req);
    const radiusKm = parseFloat(req.query.radius) || NEARBY_RADIUS_KM;
    const q = String(req.query.q || '').trim();

    let filter = {};
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ title: rx }, { role: rx }, { companyName: rx }, { skills: rx }];
    }

    const batchSize = Math.min(200, limit * 10);
    const allJobs = await Job.find(filter, JOB_CARD_PROJECTION)
      .sort({ postedAt: -1, createdAt: -1 })
      .limit(batchSize)
      .lean();

    // Other cities = jobs OUTSIDE the nearby radius
    const outsideJobs = [];
    for (const job of allJobs) {
      const jobCoords = getJobCoords(job);
      if (!coords || !jobCoords) {
        outsideJobs.push({ ...job, _realDistanceKm: null });
        continue;
      }
      const km = distanceKm(coords.lat, coords.lon, jobCoords.lat, jobCoords.lon);
      if (km > radiusKm) {
        outsideJobs.push({ ...job, _realDistanceKm: km });
      }
    }

    outsideJobs.sort((a, b) => {
      if (a._realDistanceKm == null && b._realDistanceKm == null) return 0;
      if (a._realDistanceKm == null) return 1;
      if (b._realDistanceKm == null) return -1;
      return a._realDistanceKm - b._realDistanceKm;
    });

    const total = outsideJobs.length;
    const paged = outsideJobs.slice(skip, skip + limit);

    const transformed = paged.map((j) => {
      const t = transformJobCard(j);
      if (j._realDistanceKm != null) {
        const km = j._realDistanceKm;
        t.distance = km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)} km`;
        t._distanceKm = km;
      }
      return t;
    });

    res.status(200).json({
      success: true,
      jobs: transformed,
      pagination: { page, limit, total, hasMore: skip + paged.length < total },
    });
  } catch (error) {
    console.error('[jobs.other] error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.backfillCoordinates = async (req, res) => {
  try {
    const jobs = await Job.find({ 'location.lat': { $ne: null }, 'location.lon': { $ne: null } }).limit(1000);
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