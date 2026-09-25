const Job = require('../models/Job');
const { _helpers } = require('../controllers/homeController');
const { liveJobFilter, JOB_CARD_PROJECTION } = _helpers;

async function getNearbyJobs({ lat, lon, radiusKm = 50, page = 1, limit = 20, q = '' }) {
  const skip = (page - 1) * limit;
  const matchStage = liveJobFilter();
  if (q) matchStage.$text = { $search: q };

  const pipeline = [
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lon, lat] },
        distanceField: 'distanceMeters',
        maxDistance: radiusKm * 1000,
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
              ...JOB_CARD_PROJECTION,
              distanceMeters: 1,
            },
          },
        ],
        totalCount: [{ $count: 'count' }],
      },
    },
  ];

  try {
    const result = await Job.aggregate(pipeline).exec();
    const jobs = result[0]?.jobs || [];
    const total = result[0]?.totalCount?.[0]?.count || 0;
    return { jobs, total, hasMore: skip + jobs.length < total };
  } catch (err) {
    const [jobs, total] = await Promise.all([
      Job.find(matchStage, JOB_CARD_PROJECTION).skip(skip).limit(limit).lean(),
      Job.countDocuments(matchStage),
    ]);
    return { jobs, total, hasMore: skip + jobs.length < total };
  }
}

async function getOtherCityJobs({ lat, lon, radiusKm = 50, page = 1, limit = 20, q = '' }) {
  const skip = (page - 1) * limit;
  const matchStage = liveJobFilter();
  if (q) matchStage.$text = { $search: q };

  const [jobs, total] = await Promise.all([
    Job.find(matchStage, JOB_CARD_PROJECTION).skip(skip).limit(limit).lean(),
    Job.countDocuments(matchStage),
  ]);

  return { jobs, total, hasMore: skip + jobs.length < total };
}

module.exports = { getNearbyJobs, getOtherCityJobs };