/**
 * Normalizes notification types from admin panel to mobile screen types.
 */
const TYPE_MAP = {
  job_alert: 'JOB',
  new_job: 'JOB',
  job: 'JOB',
  application_update: 'APPLICATION',
  application_status: 'APPLICATION',
  application: 'APPLICATION',
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