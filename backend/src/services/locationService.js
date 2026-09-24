const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';

// ── Indian Cities Database ──
const INDIA_CITIES = [
  { name: 'Pune', lat: 18.5204, lon: 73.8567, state: 'Maharashtra' },
  { name: 'Mumbai', lat: 19.0760, lon: 72.8777, state: 'Maharashtra' },
  { name: 'Bengaluru', lat: 12.9716, lon: 77.5946, state: 'Karnataka' },
  { name: 'Hyderabad', lat: 17.3850, lon: 78.4867, state: 'Telangana' },
  { name: 'Delhi NCR', lat: 28.6139, lon: 77.2090, state: 'Delhi' },
  { name: 'Chennai', lat: 13.0827, lon: 80.2707, state: 'Tamil Nadu' },
  { name: 'Kolkata', lat: 22.5726, lon: 88.3639, state: 'West Bengal' },
  { name: 'Ahmedabad', lat: 23.0225, lon: 72.5714, state: 'Gujarat' },
  { name: 'Jaipur', lat: 26.9124, lon: 75.7873, state: 'Rajasthan' },
  { name: 'Lucknow', lat: 26.8467, lon: 80.9462, state: 'Uttar Pradesh' },
  { name: 'Bhopal', lat: 23.2599, lon: 77.4126, state: 'Madhya Pradesh' },
  { name: 'Indore', lat: 22.7196, lon: 75.8577, state: 'Madhya Pradesh' },
  { name: 'Nagpur', lat: 21.1458, lon: 79.0882, state: 'Maharashtra' },
  { name: 'Nashik', lat: 19.9975, lon: 73.7898, state: 'Maharashtra' },
  { name: 'Surat', lat: 21.1702, lon: 72.8311, state: 'Gujarat' },
  { name: 'Noida', lat: 28.5355, lon: 77.3910, state: 'Uttar Pradesh' },
  { name: 'Gurugram', lat: 28.4595, lon: 77.0266, state: 'Haryana' },
  { name: 'Kochi', lat: 9.9312, lon: 76.2673, state: 'Kerala' },
  { name: 'Chandigarh', lat: 30.7333, lon: 76.7794, state: 'Chandigarh' },
  { name: 'Coimbatore', lat: 11.0168, lon: 76.9558, state: 'Tamil Nadu' },
];

// ── Hardcoded Area Fallbacks (instant, no API call) ──
const CITY_AREAS_FALLBACK = {
  'Pune': [
    { name: 'Chinchwad', lat: 18.6298, lon: 73.7997 },
    { name: 'Talegaon Dabhade', lat: 18.7358, lon: 73.6756 },
    { name: 'Hinjewadi', lat: 18.5905, lon: 73.7376 },
    { name: 'Wakad', lat: 18.5975, lon: 73.7625 },
    { name: 'Kharadi', lat: 18.5515, lon: 73.9370 },
    { name: 'Hadapsar', lat: 18.5089, lon: 73.9260 },
    { name: 'Baner', lat: 18.5590, lon: 73.7868 },
    { name: 'Kothrud', lat: 18.5074, lon: 73.8077 },
    { name: 'Pimpri', lat: 18.6280, lon: 73.7997 },
    { name: 'Aundh', lat: 18.5590, lon: 73.8073 },
    { name: 'Ravet', lat: 18.6510, lon: 73.7526 },
    { name: 'Nigdi', lat: 18.6540, lon: 73.7686 },
    { name: 'Viman Nagar', lat: 18.5679, lon: 73.9143 },
    { name: 'Magarpatta', lat: 18.5158, lon: 73.9268 },
    { name: 'Koregaon Park', lat: 18.5364, lon: 73.8931 },
  ],
  'Mumbai': [
    { name: 'Andheri', lat: 19.1197, lon: 72.8468 },
    { name: 'Powai', lat: 19.1197, lon: 72.9053 },
    { name: 'Bandra', lat: 19.0596, lon: 72.8295 },
    { name: 'Goregaon', lat: 19.1663, lon: 72.8526 },
    { name: 'Dadar', lat: 19.0176, lon: 72.8478 },
    { name: 'Borivali', lat: 19.2288, lon: 72.8567 },
    { name: 'Malad', lat: 19.1868, lon: 72.8484 },
    { name: 'Kurla', lat: 19.0728, lon: 72.8826 },
    { name: 'Worli', lat: 19.0176, lon: 72.8145 },
    { name: 'Thane', lat: 19.2183, lon: 72.9781 },
    { name: 'Navi Mumbai', lat: 19.0330, lon: 73.0297 },
    { name: 'Vashi', lat: 19.0754, lon: 72.9986 },
    { name: 'Airoli', lat: 19.1495, lon: 72.9985 },
  ],
  'Bengaluru': [
    { name: 'Whitefield', lat: 12.9698, lon: 77.7500 },
    { name: 'Koramangala', lat: 12.9352, lon: 77.6245 },
    { name: 'Indiranagar', lat: 12.9784, lon: 77.6408 },
    { name: 'HSR Layout', lat: 12.9116, lon: 77.6473 },
    { name: 'Electronic City', lat: 12.8452, lon: 77.6602 },
    { name: 'Bellandur', lat: 12.9257, lon: 77.6774 },
    { name: 'Marathahalli', lat: 12.9591, lon: 77.6974 },
    { name: 'Jayanagar', lat: 12.9308, lon: 77.5838 },
    { name: 'BTM Layout', lat: 12.9166, lon: 77.6101 },
  ],
  'Hyderabad': [
    { name: 'Gachibowli', lat: 17.4401, lon: 78.3489 },
    { name: 'Madhapur', lat: 17.4483, lon: 78.3915 },
    { name: 'Hitech City', lat: 17.4435, lon: 78.3772 },
    { name: 'Kondapur', lat: 17.4635, lon: 78.3630 },
    { name: 'Secunderabad', lat: 17.4399, lon: 78.4983 },
    { name: 'Jubilee Hills', lat: 17.4239, lon: 78.4128 },
    { name: 'Banjara Hills', lat: 17.4126, lon: 78.4478 },
    { name: 'Ameerpet', lat: 17.4374, lon: 78.4487 },
    { name: 'Kukatpally', lat: 17.4849, lon: 78.4138 },
  ],
  'Delhi NCR': [
    { name: 'Noida', lat: 28.5355, lon: 77.3910 },
    { name: 'Gurugram', lat: 28.4595, lon: 77.0266 },
    { name: 'Okhla', lat: 28.5355, lon: 77.2731 },
    { name: 'Dwarka', lat: 28.5921, lon: 77.0460 },
    { name: 'Sector 62', lat: 28.6272, lon: 77.3665 },
    { name: 'Sector 18', lat: 28.5697, lon: 77.3210 },
    { name: 'Connaught Place', lat: 28.6315, lon: 77.2167 },
    { name: 'Faridabad', lat: 28.4089, lon: 77.3178 },
    { name: 'Ghaziabad', lat: 28.6692, lon: 77.4538 },
    { name: 'Saket', lat: 28.5245, lon: 77.2066 },
  ],
  'Chennai': [
    { name: 'Adyar', lat: 13.0067, lon: 80.2570 },
    { name: 'Velachery', lat: 12.9750, lon: 80.2211 },
    { name: 'Guindy', lat: 13.0067, lon: 80.2206 },
    { name: 'OMR', lat: 12.9010, lon: 80.2279 },
    { name: 'T Nagar', lat: 13.0418, lon: 80.2338 },
    { name: 'Tambaram', lat: 12.9249, lon: 80.1000 },
    { name: 'Anna Nagar', lat: 13.0850, lon: 80.2101 },
  ],
  'Kolkata': [
    { name: 'Salt Lake', lat: 22.5697, lon: 88.4172 },
    { name: 'New Town', lat: 22.5808, lon: 88.4626 },
    { name: 'Rajarhat', lat: 22.5990, lon: 88.4595 },
    { name: 'Howrah', lat: 22.5958, lon: 88.2636 },
    { name: 'Tollygunge', lat: 22.4966, lon: 88.3419 },
    { name: 'Park Street', lat: 22.5525, lon: 88.3521 },
  ],
  'Bhopal': [
    { name: 'MP Nagar', lat: 23.2325, lon: 77.4348 },
    { name: 'Arera Colony', lat: 23.2093, lon: 77.4362 },
    { name: 'Kolar Road', lat: 23.1815, lon: 77.4278 },
    { name: 'Bairagarh', lat: 23.2836, lon: 77.3457 },
    { name: 'Kalpana Nagar', lat: 23.2599, lon: 77.4126 },
    { name: 'Habibganj', lat: 23.2325, lon: 77.4348 },
    { name: 'New Market', lat: 23.2599, lon: 77.4126 },
    { name: 'Shahpura', lat: 23.2093, lon: 77.4362 },
  ],
  'Indore': [
    { name: 'Vijay Nagar', lat: 22.7533, lon: 75.8937 },
    { name: 'Palasia', lat: 22.7196, lon: 75.8577 },
    { name: 'Rau', lat: 22.6485, lon: 75.8144 },
    { name: 'Sudama Nagar', lat: 22.7245, lon: 75.8420 },
  ],
};

// Resilient network request helper to safely check responses before JSON parsing
async function fetchJsonSafely(url) {
  try {
    const res = await fetch(url, {
      headers: { 
        'User-Agent': 'CareerFlowMobileJobAppSystem-Contact-Admin-At-CareerFlow-Instance.com' 
      },
    });
    
    const text = await res.text();
    if (!text || text.trim().startsWith('<') || text.trim().startsWith('<?xml')) {
      // Safely catches and handles the XML output block cleanly
      return null;
    }
    
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

async function geocodeCity(query) {
  try {
    const url = `${NOMINATIM_URL}/search?q=${encodeURIComponent(query)}&countrycodes=in&format=json&limit=1`;
    const data = await fetchJsonSafely(url);
    if (Array.isArray(data) && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon),
        displayName: data[0].display_name,
      };
    }
  } catch (err) {
    console.log('[GEOCODE] Error:', err.message);
  }
  return null;
}

async function searchLocations(query, limit = 10) {
  try {
    const url = `${NOMINATIM_URL}/search?q=${encodeURIComponent(query)}&countrycodes=in&format=json&addressdetails=1&limit=${limit}`;
    const data = await fetchJsonSafely(url);
    if (!Array.isArray(data)) return [];

    return data.map((item) => {
      const a = item.address || {};
      const city = a.city || a.town || a.village || a.city_district || a.county || '';
      const area = a.suburb || a.neighbourhood || a.sublocality || a.locality || a.state_district || '';
      const state = a.state || '';
      const country = a.country || 'India';
      const display = area && city && area !== city ? `${area}, ${city}` : (city || area || '');
      return {
        id: item.place_id || `${item.lat}-${item.lon}`,
        area, city, state, country, display,
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon),
      };
    }).filter((x) => x.display);
  } catch (err) {
    console.log('[SEARCH] Error:', err.message);
    return [];
  }
}

async function getCities(query) {
  if (query && query.trim().length >= 2) {
    const q = query.trim().toLowerCase();
    const matched = INDIA_CITIES.filter((c) => c.name.toLowerCase().includes(q));
    if (matched.length > 0) return matched;

    const results = await searchLocations(query, 10);
    const seen = new Set();
    return results
      .filter((r) => r.city && !seen.has(r.city.toLowerCase()))
      .map((r) => {
        seen.add(r.city.toLowerCase());
        return { name: r.city, lat: r.lat, lon: r.lon, state: r.state };
      });
  }
  return INDIA_CITIES;
}

async function getAreasForCity(cityName) {
  // 1. Try hardcoded fallback first (instant, reliable)
  const fallback = CITY_AREAS_FALLBACK[cityName];
  if (fallback && fallback.length > 0) return fallback;

  // 2. Try Nominatim for unknown cities
  try {
    const url = `${NOMINATIM_URL}/search?q=suburb+of+${encodeURIComponent(cityName)}&countrycodes=in&format=json&addressdetails=1&limit=30`;
    const data = await fetchJsonSafely(url);
    if (!Array.isArray(data)) return [];

    const seen = new Set();
    const areas = [];
    for (const item of data) {
      const a = item.address || {};
      const areaName = a.suburb || a.neighbourhood || a.sublocality || a.locality || '';
      const cityInAddr = a.city || a.town || '';

      if (
        areaName &&
        areaName.toLowerCase() !== cityName.toLowerCase() &&
        !seen.has(areaName.toLowerCase()) &&
        (cityInAddr.toLowerCase().includes(cityName.toLowerCase()) || !cityInAddr)
      ) {
        seen.add(areaName.toLowerCase());
        areas.push({
          name: areaName,
          lat: parseFloat(item.lat),
          lon: parseFloat(item.lon),
        });
      }
    }
    return areas;
  } catch (err) {
    console.log('[AREAS] Error:', err.message);
    return [];
  }
}

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

module.exports = { geocodeCity, searchLocations, distanceKm, getCities, getAreasForCity };