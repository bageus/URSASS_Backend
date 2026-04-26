/* eslint-disable no-console */
/**
 * Migration: referral system and share events.
 *
 * Usage:
 *   MONGO_URI='mongodb://localhost:27017/ursass' node scripts/migrations/2026-04-26-referral-and-share.js
 *
 * Idempotent: safe to run multiple times.
 */
const mongoose = require('mongoose');
const { generateReferralCode } = require('../../utils/referral');

async function run() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  // 1. Create shareevents collection and indexes
  await db.createCollection('shareevents').catch((err) => {
    if (err.codeName !== 'NamespaceExists') throw err;
  });

  await db.collection('shareevents').createIndexes([
    { key: { shareId: 1 }, name: 'shareId_1', unique: true },
    { key: { primaryId: 1, dayKey: 1 }, name: 'primaryId_1_dayKey_1' },
    { key: { primaryId: 1 }, name: 'primaryId_1' },
    { key: { dayKey: 1 }, name: 'dayKey_1' }
  ]);

  console.log('shareevents collection and indexes ready.');

  // 2. Create indexes on players collection
  await db.collection('players').createIndexes([
    { key: { referralCode: 1 }, name: 'referralCode_1', unique: true, sparse: true },
    { key: { referredBy: 1 }, name: 'referredBy_1' },
    { key: { xUserId: 1 }, name: 'xUserId_1', sparse: true }
  ]);

  console.log('players indexes ready.');

  // 3. Backfill referralCode for players without one
  const players = await db.collection('players').find({ referralCode: { $exists: false } }).toArray();
  console.log(`Found ${players.length} players without referralCode. Backfilling...`);

  let backfilled = 0;
  let skipped = 0;

  for (const player of players) {
    let code = null;
    const MAX_ATTEMPTS = 5;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const candidate = generateReferralCode();
      const existing = await db.collection('players').findOne({ referralCode: candidate });
      if (!existing) {
        code = candidate;
        break;
      }
    }

    if (!code) {
      console.warn(`  Skipped player ${player.wallet}: could not generate unique code`);
      skipped++;
      continue;
    }

    await db.collection('players').updateOne(
      { _id: player._id, referralCode: { $exists: false } },
      { $set: { referralCode: code } }
    );
    backfilled++;
  }

  console.log(`Backfill done: ${backfilled} updated, ${skipped} skipped.`);

  const totalPlayers = await db.collection('players').countDocuments();
  const withCode = await db.collection('players').countDocuments({ referralCode: { $exists: true, $ne: null } });
  const withReferredBy = await db.collection('players').countDocuments({ referredBy: { $ne: null } });

  console.log(`players total: ${totalPlayers}, with referralCode: ${withCode}, with referredBy: ${withReferredBy}`);

  console.log('Migration completed: referral-and-share.');
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Migration failed:', err.message);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
