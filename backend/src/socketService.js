const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Job = require('./models/Job');
const { distanceKm, geocodeCity } = require('./services/locationService');

let io = null;

// ── In-memory stores ──
const connectedUsers = new Map(); // userId → { socketId, lat, lon, city }
const geoCache = new Map();        // "address, city, state" → { lat, lon }

// ── Helpers ──
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fuzzyMatchJob(job, queryWords) {
  if (!queryWords || queryWords.length === 0) return true;
  const searchable = [
    job.title, job.role, job.department, job.industry,
    job.companyName, job.jobDescription, job.qualification,
    job.workMode, job.jobType, job.noticePeriod,
    job.location?.address, job.location?.city, job.location?.state, job.location?.country,
    ...(job.skills || []), ...(job.languages || []), ...(job.benefits || []),
  ].filter(Boolean).map(normalize).join(' ');
  return queryWords.every((qw) => searchable.includes(qw));
}

async function geocodeJobLocation(job) {
  const loc = job.location || {};
  if (loc.lat != null && loc.lon != null) {
    return { lat: loc.lat, lon: loc.lon };
  }
  const query = [loc.address, loc.city, loc.state, 'India'].filter(Boolean).join(', ');
  if (!query || query === 'India') return null;
  if (geoCache.has(query)) return geoCache.get(query);
  let geo = await geocodeCity(query);
  if (geo) { geoCache.set(query, geo); return geo; }
  const fallback = [loc.city, loc.state, 'India'].filter(Boolean).join(', ');
  if (fallback !== query && fallback !== 'India') {
    geo = await geocodeCity(fallback);
    if (geo) { geoCache.set(query, geo); return geo; }
  }
  if (loc.city) {
    geo = await geocodeCity(`${loc.city}, India`);
    if (geo) { geoCache.set(query, geo); return geo; }
  }
  return null;
}

function transformJobForSocket(j) {
  return {
    id: String(j._id),
    _id: String(j._id),
    title: j.title,
    company: j.companyName,
    companyLogoText: j.companyInitials,
    companyLogoUrl: j.companyLogo?.url,
    companyImages: (j.companyImages || []).map((i) => i.url),
    location: j.location?.city || '',
    city: j.location?.city || '',
    state: j.location?.state || '',
    address: j.location?.address || '',
    distance: j._distanceKm != null
      ? (j._distanceKm < 1 ? `${Math.round(j._distanceKm * 1000)}m` : `${j._distanceKm.toFixed(1)} km`)
      : '',
    _distanceKm: j._distanceKm,
    salary: j.salary ? `₹${(j.salary.min / 1000).toFixed(0)}k - ₹${(j.salary.max / 1000).toFixed(0)}k` : '',
    salaryPeriod: j.salary?.period ? `/${j.salary.period}` : '',
    experience: j.experience?.min != null ? `${j.experience.min}-${j.experience.max} yrs` : '',
    workMode: j.workMode,
    jobType: j.jobType,
    skills: j.skills || [],
    tags: j.skills || [],
    description: j.jobDescription || '',
    isSaved: false,
  };
}

function initSocket(server) {
  io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
  });

  // ── Authentication middleware ──
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      socket.userRole = decoded.role;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    console.log(`🔌 Socket connected: user=${userId} socket=${socket.id}`);

    connectedUsers.set(userId, { socketId: socket.id, lat: null, lon: null, city: '' });
    socket.join(`user:${userId}`);

    // ── LOCATION UPDATE ──
    socket.on('location:update', (data) => {
      const { lat, lon, city, subLocation } = data || {};
      const user = connectedUsers.get(userId);
      if (user) { user.lat = lat; user.lon = lon; user.city = city; }
      socket.broadcast.emit('location:changed', { userId, city, subLocation, lat, lon });
      console.log(`📍 [${userId}] location: ${subLocation}, ${city}`);
    });

    // ── JOIN CITY ROOM ──
    socket.on('room:joinCity', (cityName) => {
      const rooms = Array.from(socket.rooms);
      rooms.forEach((room) => { if (room.startsWith('city:')) socket.leave(room); });
      if (cityName) {
        socket.join(`city:${cityName}`);
        console.log(`🏙️ [${userId}] joined city: ${cityName}`);
      }
    });

    // ── REAL-TIME JOB SEARCH ──
    socket.on('jobs:search', async (data) => {
      try {
        const { lat, lon, radiusKm = 50, q = '', type = 'nearby', page = 1, limit = 50 } = data || {};
        const requestId = data?.requestId || Date.now();

        if (!lat || !lon) {
          socket.emit('jobs:result', { requestId, type, jobs: [], total: 0, hasMore: false });
          return;
        }

        console.log(`🔍 [${userId}] socket search: type=${type} q="${q}" radius=${radiusKm}`);

        const queryWords = normalize(q).split(' ').filter((w) => w.length >= 2);
        const allJobs = await Job.find({ status: 'Live', isActive: true })
          .sort({ postedAt: -1, createdAt: -1 })
          .limit(500)
          .lean();

        const matched = [];
        for (const job of allJobs) {
          if (queryWords.length && !fuzzyMatchJob(job, queryWords)) continue;
          const geo = await geocodeJobLocation(job);
          if (!geo) {
            if (type === 'other') matched.push({ ...job, _distanceKm: 9999 });
            continue;
          }
          const d = distanceKm(lat, lon, geo.lat, geo.lon);
          if (type === 'nearby' && d <= radiusKm) matched.push({ ...job, _distanceKm: d });
          else if (type === 'other' && d > radiusKm) matched.push({ ...job, _distanceKm: d });
        }

        matched.sort((a, b) => a._distanceKm - b._distanceKm);
        const total = matched.length;
        const skip = (page - 1) * limit;
        const paged = matched.slice(skip, skip + limit);

        socket.emit('jobs:result', {
          requestId,
          type,
          jobs: paged.map(transformJobForSocket),
          total,
          hasMore: skip + paged.length < total,
          page,
          limit,
        });
      } catch (err) {
        console.error('[SOCKET jobs:search] error:', err.message);
        socket.emit('jobs:error', { message: err.message });
      }
    });

    // ── NEW JOB POSTED (from recruiter panel) ──
    socket.on('job:posted', (jobData) => {
      if (jobData?.city) io.to(`city:${jobData.city}`).emit('job:new', jobData);
      io.emit('job:new', jobData);
    });

    // ── APPLICATION STATUS UPDATE ──
    socket.on('application:update', (data) => {
      const { applicationId, status, userId: targetUserId } = data || {};
      if (targetUserId) io.to(`user:${targetUserId}`).emit('application:statusChanged', { applicationId, status });
    });

    // ── PING/PONG for health checks ──
    socket.on('ping:check', () => socket.emit('pong:check', { time: Date.now() }));

    socket.on('disconnect', (reason) => {
      console.log(`🔌 Socket disconnected: user=${userId} reason=${reason}`);
      connectedUsers.delete(userId);
    });
  });

  console.log('✅ Socket.IO initialized');
  return io;
}

// ── External helpers ──
function emitToUser(userId, event, data) { if (io) io.to(`user:${userId}`).emit(event, data); }
function emitToCity(cityName, event, data) { if (io) io.to(`city:${cityName}`).emit(event, data); }
function broadcast(event, data) { if (io) io.emit(event, data); }
function getOnlineCount() { return connectedUsers.size; }
function getIO() { return io; }

module.exports = { initSocket, emitToUser, emitToCity, broadcast, getOnlineCount, getIO };