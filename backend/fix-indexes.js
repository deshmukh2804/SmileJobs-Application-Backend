require('dotenv').config();
const mongoose = require('mongoose');

async function fix() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB.');

    const collection = mongoose.connection.collection('users');
    
    // Drop all old indexes except _id
    console.log('Dropping old indexes on users collection...');
    await collection.dropIndexes();
    console.log('✅ Old indexes dropped successfully!');

    console.log('Re-syncing new partial indexes...');
    const User = require('./src/models/User');
    await User.syncIndexes();
    console.log('✅ New indexes built successfully!');

    process.exit(0);
  } catch (err) {
    console.error('Error fixing indexes:', err.message);
    process.exit(1);
  }
}

fix();