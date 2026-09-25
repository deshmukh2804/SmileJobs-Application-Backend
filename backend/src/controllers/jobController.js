const Job = require('../models/Job');
const { _helpers } = require('./homeController');
const { liveJobFilter, transformJobCard, transformJobDetail, JOB_CARD_PROJECTION } = _helpers;

const NEARBY_RADIUS_KM = 50;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

// ─────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────
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

function parseRadius(req, def = NEARBY_RADIUS_KM) {
  const r = parseFloat(req.query.radius);
  if (!Number.isFinite(r) || r <= 0) return def;
  return Math.min(500, r); // cap at 500km
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─────────────────────────────────────────────
// GET /api/v1/jobs
// Basic paginated list with optional filters
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

    // ✅ Use projection — only fetch fields we need for cards
    const [jobs, total] = await Promise.all([
      Job.find(filter, JOB_CARD_PROJECTION)
        .sort({ postedAt: -1 })
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
    res.status(500).json({
      success: false,
      message: error.message,
      code: 'JOB_LIST_ERROR',
      requestId: req.id,
    });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/jobs/search?q=...
// Uses MongoDB TEXT INDEX (not regex $or)
// ─────────────────────────────────────────────
exports.searchJobs = async (req, res) => {
  try {
    const rawQ = (req.query.q || req.query.query || '').toString().trim();
    const { page, limit, skip } = parsePagination(req);

    const base = liveJobFilter();
    let filter = base;
    let sort = { postedAt: -1 };
    let projection = { ...JOB_CARD_PROJECTION };

    if (rawQ) {
      // ✅ Use $text search (backed by text index in Job.js)
      // Falls back to regex if text search returns nothing
      filter = { ...base, $text: { $search: rawQ } };
      projection.score = { $meta: 'textScore' };
      sort = { score: { $meta: 'textScore' }, postedAt: -1 };
    }

    if (req.query.city) filter['location.city'] = new RegExp(escapeRegex(String(req.query.city).trim()), 'i');
    if (req.query.workMode) filter.workMode = req.query.workMode;
    if (req.query.jobType) filter.jobType = req.query.jobType;

    let jobs = [];
    let total = 0;

    try {
      [jobs, total] = await Promise.all([
        Job.find(filter, projection).sort(sort).skip(skip).limit(limit).lean(),
        Job.countDocuments(filter),
      ]);
    } catch (textErr) {
      // If text index isn't built yet, fall back to regex on a subset of fields
      console.warn('[jobs.search] text index failed, falling back to regex:', textErr.message);
      if (rawQ) {
        const rx = new RegExp(escapeRegex(rawQ), 'i');
        filter = {
          ...base,
          $or: [
            { title: rx },
            { role: rx },
            { companyName: rx },
            { 'location.city': rx },
            { skills: rx },
          ],
        };
        [jobs, total] = await Promise.all([
          Job.find(filter, JOB_CARD_PROJECTION).sort({ postedAt: -1 }).skip(skip).limit(limit).lean(),
          Job.countDocuments(filter),
        ]);
      }
    }

    res.set('Cache-Control', 'private, max-age=10');
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
    res.status(500).json({
      success: false,
      message: error.message,
      code: 'JOB_SEARCH_ERROR',
      requestId: req.id,
    });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/jobs/:id
// Returns FULL job detail (uses transformJobDetail)
// ─────────────────────────────────────────────
exports.getJobById = async (req, res) => {
  try {
    const { id } = req.params;
    // Validate ObjectId format
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid job ID',
        code: 'INVALID_JOB_ID',
      });
    }

    const job = await Job.findOne({ _id: id, ...liveJobFilter() }).lean();
    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found',
        code: 'JOB_NOT_FOUND',
      });
    }

    res.set('Cache-Control', 'private, max-age=60');
    res.status(200).json({ success: true, job: transformJobDetail(job) });
  } catch (error) {
    console.error('[jobs.getById] error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      code: 'JOB_DETAIL_ERROR',
      requestId: req.id,
    });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/jobs/nearby?lat=&lon=&radius=50&page=&limit=&q=
// ✅ USES $geoNear — no more 500-doc downloads
// ✅ Distance calculated by MongoDB, not Node.js
// ✅ Uses 2dsphere index
// ─────────────────────────────────────────────
exports.getNearbyJobs = async (req, res) => {
  try {
    const coords = parseCoords(req);
    if (!coords) {
      return res.status(400).json({
        success: false,
        message: 'Valid lat and lon are required',
        code: 'INVALID_COORDS',
      });
    }

    const radiusKm = parseRadius(req, NEARBY_RADIUS_KM);
    const { page, limit, skip } = parsePagination(req);
    const q = String(req.query.q || '').trim();

    // Build post-geo match stage (applied AFTER geospatial filter)
    const matchStage = liveJobFilter();
    if (q) {
      // Use $text if index exists
      matchStage.$text = { $search: q };
    }
    if (req.query.city) matchStage['location.city'] = new RegExp(escapeRegex(req.query.city), 'i');
    if (req.query.workMode) matchStage.workMode = req.query.workMode;
    if (req.query.jobType) matchStage.jobType = req.query.jobType;

    // ✅ MongoDB $geoNear aggregation
    // - Uses 2dsphere index for efficient geo query
    // - MongoDB does the distance math (fast, indexed)
    // - Only returns jobs within radius
    const pipeline = [
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [coords.lon, coords.lat] },
          distanceField: 'distanceMeters',
          maxDistance: radiusKm * 1000, // convert km → meters
          spherical: true,
          key: 'location.geo',
          query: matchStage,
        },
      },
      {
        $facet: {
          jobs: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                ...Object.keys(JOB_CARD_PROJECTION).reduce((acc, k) => {
                  acc[k] = 1;
                  return acc;
                }, {}),
                distanceMeters: 1,
              },
            },
          ],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    let result;
    try {
      result = await Job.aggregate(pipeline).exec();
    } catch (geoErr) {
      // If 2dsphere index doesn't exist yet (fresh deploy),
      // fall back gracefully to returning empty with a hint
      if (geoErr.message.includes('$geoNear') || geoErr.message.includes('2dsphere') || geoErr.message.includes('geoNear')) {
        console.warn('[jobs.nearby] Geospatial index not ready. Run backfill-geo.js');
        return res.status(200).json({
          success: true,
          jobs: [],
          pagination: { page, limit, total: 0, hasMore: false, hasNextPage: false },
          radiusKm,
          _warning: 'Geospatial index initializing, please retry shortly',
        });
      }
      throw geoErr;
    }

    const jobs = result[0]?.jobs || [];
    const total = result[0]?.totalCount?.[0]?.count || 0;

    // Attach distance display to each job
    const transformed = jobs.map((j) => {
      const t = transformJobCard(j);
      if (j.distanceMeters != null) {
        const km = j.distanceMeters / 1000;
        t.distance = km < 1
          ? `${Math.round(j.distanceMeters)}m`
          : `${km.toFixed(1)} km`;
        t._distanceKm = km;
      }
      return t;
    });

    res.set('Cache-Control', 'private, max-age=15');
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
    res.status(500).json({
      success: false,
      message: error.message,
      code: 'JOB_NEARBY_ERROR',
      requestId: req.id,
    });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/jobs/other?lat=&lon=&radius=50&page=&limit=&q=
// ✅ Uses $geoNear with min-distance filter
// ✅ Everything OUTSIDE the radius
// ─────────────────────────────────────────────
exports.getOtherCityJobs = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req);
    const q = String(req.query.q || '').trim();
    const coords = parseCoords(req);

    // If no coords provided, fall back to regular paginated list
    if (!coords) {
      const baseFilter = liveJobFilter();
      if (q) baseFilter.$text = { $search: q };

      const [jobs, total] = await Promise.all([
        Job.find(baseFilter, JOB_CARD_PROJECTION)
          .sort({ postedAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Job.countDocuments(baseFilter),
      ]);

      return res.status(200).json({
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
    }

    const radiusKm = parseRadius(req, NEARBY_RADIUS_KM);
    const matchStage = liveJobFilter();
    if (q) matchStage.$text = { $search: q };
    if (req.query.workMode) matchStage.workMode = req.query.workMode;
    if (req.query.jobType) matchStage.jobType = req.query.jobType;

    // ✅ $geoNear with minDistance = radiusKm → gets jobs OUTSIDE the radius
    const pipeline = [
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [coords.lon, coords.lat] },
          distanceField: 'distanceMeters',
          minDistance: radiusKm * 1000,      // outside the nearby zone
          maxDistance: 5000 * 1000,          // hard cap: 5000 km (covers all India + more)
          spherical: true,
          key: 'location.geo',
          query: matchStage,
        },
      },
      {
        $facet: {
          jobs: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                ...Object.keys(JOB_CARD_PROJECTION).reduce((acc, k) => {
                  acc[k] = 1;
                  return acc;
                }, {}),
                distanceMeters: 1,
              },
            },
          ],
          totalCount: [{ $count: 'count' }],
        },
      },
    ];

    let result;
    try {
      result = await Job.aggregate(pipeline).exec();
    } catch (geoErr) {
      if (geoErr.message.includes('$geoNear') || geoErr.message.includes('2dsphere') || geoErr.message.includes('geoNear')) {
        console.warn('[jobs.other] Geospatial index not ready. Run backfill-geo.js');
        return res.status(200).json({
          success: true,
          jobs: [],
          pagination: { page, limit, total: 0, hasMore: false, hasNextPage: false },
          _warning: 'Geospatial index initializing, please retry shortly',
        });
      }
      throw geoErr;
    }

    const jobs = result[0]?.jobs || [];
    const total = result[0]?.totalCount?.[0]?.count || 0;

    const transformed = jobs.map((j) => {
      const t = transformJobCard(j);
      if (j.distanceMeters != null) {
        const km = j.distanceMeters / 1000;
        t.distance = km < 1
          ? `${Math.round(j.distanceMeters)}m`
          : `${km.toFixed(1)} km`;
        t._distanceKm = km;
      }
      return t;
    });

    res.set('Cache-Control', 'private, max-age=15');
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
    });
  } catch (error) {
    console.error('[jobs.other] error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      code: 'JOB_OTHER_ERROR',
      requestId: req.id,
    });
  }
};

// ─────────────────────────────────────────────
// GET /api/v1/jobs/backfill-coords
// ✅ Admin utility — pre-computes GeoJSON for existing jobs
// (Also available as CLI script: backend/scripts/backfill-geo.js)
// ─────────────────────────────────────────────
exports.backfillCoordinates = async (req, res) => {
  try {
    const jobs = await Job.find({
      'location.lat': { $ne: null },
      'location.lon': { $ne: null },
      $or: [
        { 'location.geo': { $exists: false } },
        { 'location.geo.coordinates': { $exists: false } },
      ],
    }).select('_id location').limit(1000);

    let updated = 0;
    for (const job of jobs) {
      const lat = parseFloat(job.location.lat);
      const lon = parseFloat(job.location.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      await Job.updateOne(
        { _id: job._id },
        {
          $set: {
            'location.geo': {
              type: 'Point',
              coordinates: [lon, lat],
            },
          },
        }
      );
      updated++;
    }

    res.status(200).json({
      success: true,
      total: jobs.length,
      updated,
      message: `Backfilled ${updated} jobs. Run again if there are more.`,
    });
  } catch (error) {
    console.error('[jobs.backfill] error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      code: 'BACKFILL_ERROR',
    });
  }
};