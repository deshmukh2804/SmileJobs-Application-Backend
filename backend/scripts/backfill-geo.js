// backend/scripts/backfill-geo.js
//
// One-time script to add GeoJSON `location.geo` field to existing jobs
// that were created before the 2dsphere index was added.
//
// USAGE:
//   node backend/scripts/backfill-geo.js
//
// Safe to run multiple times — only processes jobs missing the geo field.

require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error('❌ MONGO_URI is not set');
    process.exit(1);
  }

  console.log('🔌 Connecting to MongoDB...');
  const conn = await mongoose.createConnection(mongoURI, {
    dbName: 'Job_db',
    maxPoolSize: 5,
  }).asPromise();

  console.log(`✅ Connected to ${conn.name}`);

  const Job = conn.collection('jobs');

  // Count jobs needing backfill
  const needsBackfill = await Job.countDocuments({
    'location.lat': { $ne: null, $exists: true },
    'location.lon': { $ne: null, $exists: true },
    $or: [
      { 'location.geo': { $exists: false } },
      { 'location.geo.coordinates': { $exists: false } },
    ],
  });

  console.log(`📊 Found ${needsBackfill} jobs needing GeoJSON backfill`);

  if (needsBackfill === 0) {
    console.log('✅ Nothing to do. All jobs already have GeoJSON coordinates.');
    await conn.close();
    process.exit(0);
  }

  const cursor = Job.find({
    'location.lat': { $ne: null, $exists: true },
    'location.lon': { $ne: null, $exists: true },
    $or: [
      { 'location.geo': { $exists: false } },
      { 'location.geo.coordinates': { $exists: false } },
    ],
  }, { projection: { _id: 1, 'location.lat': 1, 'location.lon': 1 } });

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const BATCH_SIZE = 100;
  let batch = [];

  const flush = async () => {
    if (batch.length === 0) return;
    try {
      const bulkResult = await Job.bulkWrite(batch, { ordered: false });
      updated += bulkResult.modifiedCount || 0;
    } catch (err) {
      console.error('❌ Batch write error:', err.message);
      failed += batch.length;
    }
    batch = [];
  };

  for await (const job of cursor) {
    const lat = parseFloat(job.location?.lat);
    const lon = parseFloat(job.location?.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      skipped++;
      continue;
    }

    batch.push({
      updateOne: {
        filter: { _id: job._id },
        update: {
          $set: {
            'location.geo': {
              type: 'Point',
              coordinates: [lon, lat],
            },
          },
        },
      },
    });

    if (batch.length >= BATCH_SIZE) {
      await flush();
      if ((updated + skipped + failed) % 500 === 0) {
        console.log(`  Progress: updated=${updated} skipped=${skipped} failed=${failed}`);
      }
    }
  }

  await flush();

  console.log('\n═══════════════════════════════════════');
  console.log(`✅ Backfill complete`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Skipped (invalid coords): ${skipped}`);
  console.log(`   Failed:  ${failed}`);
  console.log('═══════════════════════════════════════\n');

  // Ensure 2dsphere index exists
  console.log('🔧 Ensuring 2dsphere index...');
  try {
    await Job.createIndex({ 'location.geo': '2dsphere' });
    console.log('✅ 2dsphere index ready');
  } catch (err) {
    console.warn('⚠️  Index creation warning:', err.message);
  }

  await conn.close();
  console.log('👋 Disconnected. Done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('💥 Fatal:', err);
  process.exit(1);
});