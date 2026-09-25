const Job = require('../models/Job');
const { _helpers } = require('../controllers/homeController');
const { liveJobFilter, JOB_CARD_PROJECTION } = _helpers;

/**
 * Fetch nearby jobs using MongoDB $geoNear.
 * Consolidates the duplicate logic that used to live in jobController.js AND jobService.js.
 *
 * @param {Object} params
 * @param {number} params.lat
 * @param {number} params.lon
 * @param {number} [params.radiusKm=50]
 * @param {number} [params.page=1]
 * @param {number} [params.limit=20]
 * @param {string} [params.q]
 * @returns {Promise<{jobs: Array, total: number, hasMore: boolean}>}
 */
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

  const result = await Job.aggregate(pipeline).exec();
  const jobs = result[0]?.jobs || [];
  const total = result[0]?.totalCount?.[0]?.count || 0;

  return {
    jobs,
    total,
    hasMore: skip + jobs.length < total,
  };
}

/**
 * Fetch jobs OUTSIDE the given radius (other cities).
 */
async function getOtherCityJobs({ lat, lon, radiusKm = 50, page = 1, limit = 20, q = '' }) {
  const skip = (page - 1) * limit;
  const matchStage = liveJobFilter();
  if (q) matchStage.$text = { $search: q };

  const pipeline = [
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lon, lat] },
        distanceField: 'distanceMeters',
        minDistance: radiusKm * 1000,
        maxDistance: 5000 * 1000,
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

  const result = await Job.aggregate(pipeline).exec();
  const jobs = result[0]?.jobs || [];
  const total = result[0]?.totalCount?.[0]?.count || 0;

  return {
    jobs,
    total,
    hasMore: skip + jobs.length < total,
  };
}

module.exports = { getNearbyJobs, getOtherCityJobs };