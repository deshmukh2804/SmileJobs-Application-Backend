/**
 * Normalizes notification types from admin panel to mobile screen types.
 */
const TYPE_MAP = {
  // Job related
  job_alert: 'JOB',
  new_job: 'JOB',
  job: 'JOB',
  job_opening: 'JOB',
  job_post: 'JOB',

  // General Application related
  application_update: 'APPLICATION',
  application_status: 'APPLICATION',
  application: 'APPLICATION',

  // ✅ NEW Detailed Status Triggers (For WorkIndia style template)
  profile_review: 'APPLICATION_UPDATE',
  application_viewed: 'APPLICATION_UPDATE',
  application_shortlisted: 'APPLICATION_UPDATE',
  application_interview: 'APPLICATION_UPDATE',
  application_offered: 'APPLICATION_UPDATE',
  application_hired: 'APPLICATION_UPDATE',
  application_rejected: 'APPLICATION_UPDATE',

  // Others
  message: 'MESSAGE',
  chat: 'MESSAGE',
  promotion: 'PROMOTION',
  premium: 'PROMOTION',
  profile: 'PROFILE',
  general: 'GENERAL',
};

function mapType(adminType) {
  if (!adminType) return 'GENERAL';
  const clean = String(adminType).toLowerCase().trim();
  return TYPE_MAP[clean] || 'GENERAL';
}

module.exports = { mapType };