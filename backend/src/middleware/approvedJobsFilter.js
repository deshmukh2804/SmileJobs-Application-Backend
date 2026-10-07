// src/middleware/approvedJobsFilter.js
// 🔒 FINAL SAFETY NET: Removes any unapproved jobs from the response
// This runs AFTER controllers, catching anything that leaks through

const Job = require('../models/Job');

/**
 * Checks if a job object is approved.
 * Handles cases where approvalStatus might be missing from the transformed object.
 */
const isJobApproved = async (jobId) => {
  if (!jobId) return false;
  try {
    const job = await Job.findById(jobId).select('approvalStatus status isActive').lean();
    if (!job) return false;
    return (
      job.approvalStatus === 'approved' &&
      job.status === 'Live' &&
      job.isActive === true
    );
  } catch (err) {
    return false;
  }
};

/**
 * Middleware: Intercepts res.json() and filters out non-approved jobs
 */
const filterApprovedJobsOnly = (req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = async (data) => {
    try {
      if (data && typeof data === 'object') {
        // Case 1: data.jobs is an array
        if (Array.isArray(data.jobs)) {
          const approvedJobs = [];
          for (const job of data.jobs) {
            const id = job?.id || job?._id;
            if (id && (await isJobApproved(id))) {
              approvedJobs.push(job);
            }
          }
          const removed = data.jobs.length - approvedJobs.length;
          if (removed > 0) {
            console.log(`🚫 Filtered out ${removed} unapproved jobs from response`);
          }
          data.jobs = approvedJobs;
          if (data.pagination && typeof data.pagination.total === 'number') {
            data.pagination.total = approvedJobs.length;
          }
        }

        // Case 2: Single job object (job detail endpoint)
        if (data.job && (data.job.id || data.job._id)) {
          const id = data.job.id || data.job._id;
          const approved = await isJobApproved(id);
          if (!approved) {
            console.log(`🚫 Blocked unapproved single job: ${id}`);
            return originalJson({
              success: false,
              message: 'Job not found or not yet approved',
            });
          }
        }

        // Case 3: Home screen sections
        if (Array.isArray(data.sections)) {
          for (const section of data.sections) {
            if (Array.isArray(section.items) && (section.type === 'jobs' || section.type === 'featuredJob')) {
              const approvedItems = [];
              for (const item of section.items) {
                const id = item?.id || item?._id;
                if (id && (await isJobApproved(id))) {
                  approvedItems.push(item);
                }
              }
              const removed = section.items.length - approvedItems.length;
              if (removed > 0) {
                console.log(`🚫 Filtered out ${removed} unapproved jobs from section "${section.sectionKey}"`);
              }
              section.items = approvedItems;
            }
          }
        }
      }
    } catch (err) {
      console.error('❌ approvedJobsFilter error:', err.message);
    }
    return originalJson(data);
  };

  next();
};

module.exports = filterApprovedJobsOnly;