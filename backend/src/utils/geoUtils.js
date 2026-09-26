// utils/geoUtils.js
const LOCAL_COORDS = {
  // COPY EXACT SAME OBJECT from jobController.js
};

function distanceKm(lat1, lon1, lat2, lon2) { /* copy from jobController */ }
function getJobCoords(job) { /* copy from jobController — uses LOCAL_COORDS */ }
function parseCoords(req) { /* copy from jobController */ }
function escapeRegex(str) { /* copy from jobController */ }
function parsePagination(req) { /* copy from jobController */ }

module.exports = { LOCAL_COORDS, distanceKm, getJobCoords, parseCoords, escapeRegex, parsePagination };