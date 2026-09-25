const path = require('path');
const dotenv = require('dotenv');
const http = require('http');

// MUST be first
dotenv.config({ path: path.join(__dirname, '.env') });

const connectDB = require('./src/config/db');
const app = require('./src/app');
const { initSocket } = require('./src/socketService');

// force-load cloudinary early so you see logs
require('./src/config/cloudinary');

// ✅ ADD: Initialize Firebase Admin at startup (production-safe)
const { initFirebaseAdmin } = require('./src/config/firebaseAdmin');
initFirebaseAdmin();

connectDB();

const PORT = process.env.PORT || 5001;

// Create HTTP server (required for Socket.IO)
const server = http.createServer(app);

// Initialize Socket.IO on the same server
initSocket(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   🔐 Auth Microservice Running           ║
  ║   📍 http://localhost:${PORT}              ║
  ║   🔌 Socket.IO: ws://localhost:${PORT}     ║
  ║   🔧 Debug OTP: ${process.env.DEBUG_OTP === 'true' ? 'ON  ✅' : 'OFF ❌'}                 ║
  ║   ☁️  Cloud: ${process.env.CLOUDINARY_CLOUD_NAME || 'MISSING'}      ║
  ╚══════════════════════════════════════════╝
  `);
});