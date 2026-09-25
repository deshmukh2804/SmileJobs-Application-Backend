const { Server } = require('socket.io');
const { socketAuthMiddleware } = require('./middleware/authMiddleware');

let io = null;
const userSockets = new Map(); // userId -> Set of socketIds

/**
 * Main Socket Server Initializer
 */
function initSocket(httpServer) {
  if (io) return io;

  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      credentials: true,
    },
    pingTimeout: 30000,
    pingInterval: 15000,
  });

  // Attach handshake authentication
  if (socketAuthMiddleware) {
    io.use(socketAuthMiddleware);
  }

  io.on('connection', (socket) => {
    const userId = socket.userId;
    console.log(`🔌 [Socket.IO] Connected: ${socket.id} (User: ${userId || 'anonymous'})`);

    if (userId) {
      if (!userSockets.has(userId)) {
        userSockets.set(userId, new Set());
      }
      userSockets.get(userId).add(socket.id);
      socket.join(`user:${userId}`);
    }

    // Dynamic city room join
    socket.on('room:join:city', (cityName) => {
      if (cityName && typeof cityName === 'string') {
        const cleanCity = cityName.trim().toLowerCase();
        const currentRooms = Array.from(socket.rooms);
        currentRooms.forEach((r) => {
          if (r.startsWith('city:') && r !== `city:${cleanCity}`) {
            socket.leave(r);
          }
        });
        socket.join(`city:${cleanCity}`);
        console.log(`🌐 [Socket.IO] Client ${socket.id} joined city room: city:${cleanCity}`);
      }
    });

    // Location update listener
    socket.on('user:location:update', (data) => {
      if (data && data.city) {
        const cleanCity = data.city.trim().toLowerCase();
        socket.join(`city:${cleanCity}`);
      }
    });

    socket.on('disconnect', () => {
      console.log(`🔌 [Socket.IO] Disconnected: ${socket.id}`);
      if (userId && userSockets.has(userId)) {
        const sessions = userSockets.get(userId);
        sessions.delete(socket.id);
        if (sessions.size === 0) {
          userSockets.delete(userId);
        }
      }
    });
  });

  console.log('✅ Socket.IO initialized');
  return io;
}

function getIO() {
  return io;
}

/**
 * Emit event to a specific user's private room
 */
function emitToUser(userId, event, data) {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit(event, {
    ...data,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Emit event to all users in a specific city
 */
function emitToCity(city, event, data) {
  if (!io || !city) return;
  io.to(`city:${city.trim().toLowerCase()}`).emit(event, {
    ...data,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Broadcast event globally
 */
function broadcastEvent(event, data) {
  if (!io) return;
  io.emit(event, {
    ...data,
    timestamp: new Date().toISOString(),
  });
}

// ✅ SUPPORT ALL IMPORT PATTERNS:
// 1. const initSocket = require('./socketService') -> initSocket(server)
// 2. const { initSocket } = require('./socketService') -> initSocket(server)
// 3. const { initSocketServer } = require('./socketService')
// 4. const { emitToUser, emitToCity } = require('./socketService')
initSocket.initSocket = initSocket;
initSocket.initSocketServer = initSocket;
initSocket.init = initSocket;
initSocket.getIO = getIO;
initSocket.emitToUser = emitToUser;
initSocket.emitToCity = emitToCity;
initSocket.broadcastEvent = broadcastEvent;

module.exports = initSocket;