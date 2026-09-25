const mongoose = require('mongoose');

const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!mongoURI) {
  console.error("❌ MONGO_URI environment variable is missing!");
  process.exit(1);
}

// ─── SECONDARY CONNECTION: Job_db (Synchronous Instantiation) ───
// This compiles immediately to prevent schema-registration race conditions during boot
const jobDbConnection = mongoose.createConnection(mongoURI, {
  dbName: "Job_db",
});

jobDbConnection.on("connected", () => {
  console.log(
    `✅ MongoDB Connected (User App Jobs DB): ${jobDbConnection.host}/${jobDbConnection.name}`
  );
});

jobDbConnection.on("error", (err) => {
  console.error(`❌ Job_db Connection Error: ${err.message}`);
});

// ─── TERTIARY CONNECTION: application_db (Synchronous Instantiation) ───
// This ensures all Applications are stored in a dedicated database
const applicationDbConnection = mongoose.createConnection(mongoURI, {
  dbName: "application_db",
});

applicationDbConnection.on("connected", () => {
  console.log(
    `✅ MongoDB Connected (Applications DB): ${applicationDbConnection.host}/${applicationDbConnection.name}`
  );
});

applicationDbConnection.on("error", (err) => {
  console.error(`❌ application_db Connection Error: ${err.message}`);
});

// ─── QUATERNARY CONNECTION: careerflow_admin (Synchronous Instantiation) ───
// ✅ This is where the ORIGINAL User profile data lives (users collection)
// All User model reads/writes go here — auth, profile, FCM tokens, everything.
const careerflowAdminDbConnection = mongoose.createConnection(mongoURI, {
  dbName: "careerflow_admin",
});

careerflowAdminDbConnection.on("connected", () => {
  console.log(
    `✅ MongoDB Connected (Careerflow Admin DB — Users): ${careerflowAdminDbConnection.host}/${careerflowAdminDbConnection.name}`
  );
});

careerflowAdminDbConnection.on("error", (err) => {
  console.error(`❌ careerflow_admin Connection Error: ${err.message}`);
});

// ─── PRIMARY CONNECTION FUNCTION: careerflow_admin (or default) ───
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(mongoURI);
    console.log(`✅ MongoDB Connected (Primary): ${conn.connection.host}/${conn.connection.name}`);
  } catch (error) {
    console.error(`❌ MongoDB Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
module.exports.jobDbConnection = jobDbConnection;
module.exports.applicationDbConnection = applicationDbConnection;
module.exports.careerflowAdminDbConnection = careerflowAdminDbConnection;