const mongoose = require('mongoose');

const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!mongoURI) {
  console.error("❌ MONGO_URI environment variable is missing!");
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// PRODUCTION-GRADE CONNECTION OPTIONS (tuned for 200k MAU)
// ─────────────────────────────────────────────────────────────
const CONNECTION_OPTIONS = {
  // Connection Pool — reuse connections across requests
  maxPoolSize: 50,              // Max concurrent connections per instance
  minPoolSize: 5,               // Keep 5 connections warm
  maxIdleTimeMS: 30000,         // Close idle connections after 30s

  // Timeouts — fail fast, don't hang forever
  serverSelectionTimeoutMS: 10000,  // 10s to find a server
  socketTimeoutMS: 45000,           // 45s for socket operations
  connectTimeoutMS: 10000,          // 10s to establish connection

  // Reliability
  retryWrites: true,
  retryReads: true,

  // Performance
  compressors: ['zlib'],            // Compress network traffic
  zlibCompressionLevel: 6,

  // Family — force IPv4 (avoids DNS issues on Render)
  family: 4,
};

// Helper: attach standard event listeners to any connection
function attachListeners(conn, label) {
  conn.on('connected', () => {
    console.log(`✅ MongoDB Connected (${label}): ${conn.host}/${conn.name}`);
  });
  conn.on('error', (err) => {
    console.error(`❌ ${label} Connection Error: ${err.message}`);
  });
  conn.on('disconnected', () => {
    console.warn(`⚠️  ${label} Disconnected`);
  });
  conn.on('reconnected', () => {
    console.log(`🔄 ${label} Reconnected`);
  });
}

// ─── SECONDARY CONNECTION: Job_db ───
const jobDbConnection = mongoose.createConnection(mongoURI, {
  ...CONNECTION_OPTIONS,
  dbName: "Job_db",
});
attachListeners(jobDbConnection, 'Job_db');

// ─── TERTIARY CONNECTION: application_db ───
const applicationDbConnection = mongoose.createConnection(mongoURI, {
  ...CONNECTION_OPTIONS,
  dbName: "application_db",
});
attachListeners(applicationDbConnection, 'application_db');

// ─── QUATERNARY CONNECTION: careerflow_admin (Users live here) ───
const careerflowAdminDbConnection = mongoose.createConnection(mongoURI, {
  ...CONNECTION_OPTIONS,
  dbName: "careerflow_admin",
});
attachListeners(careerflowAdminDbConnection, 'careerflow_admin');

// ─── PRIMARY CONNECTION FUNCTION (default mongoose connection) ───
const connectDB = async () => {
  try {
    // Use careerflow_admin as the default DB so ANY code using
    // mongoose.model() or mongoose.connection.db goes to the right place
    await mongoose.connect(mongoURI, {
      ...CONNECTION_OPTIONS,
      dbName: "careerflow_admin",
    });
    console.log(`✅ MongoDB Connected (Primary/Default): ${mongoose.connection.host}/${mongoose.connection.name}`);

    // Set global mongoose config for production
    mongoose.set('strictQuery', true);

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('🛑 SIGINT received — closing MongoDB connections...');
      await Promise.all([
        mongoose.connection.close(),
        jobDbConnection.close(),
        applicationDbConnection.close(),
        careerflowAdminDbConnection.close(),
      ]);
      console.log('✅ All MongoDB connections closed');
      process.exit(0);
    });
  } catch (error) {
    console.error(`❌ MongoDB Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
module.exports.jobDbConnection = jobDbConnection;
module.exports.applicationDbConnection = applicationDbConnection;
module.exports.careerflowAdminDbConnection = careerflowAdminDbConnection;