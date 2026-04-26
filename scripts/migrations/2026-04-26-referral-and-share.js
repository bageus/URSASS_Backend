#!/usr/bin/env node
/**
 * Migration: 2026-04-26-referral-and-share
 *
 * - Creates the shareevents collection and its indexes
 * - Backfills referralCode for all existing Player documents that lack one
 * - Ensures sparse-unique indexes on players.referralCode and players.xUserId
 * - Ensures index on players.referredBy
 *
 * Idempotent — safe to run multiple times.
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { generateReferralCode } = require('../../utils/referral');

const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI;

if (!MONGO_URL) {
  console.error('ERROR: MONGO_URL environment variable is required');
  process.exit(1);
}

async function run() {
  await mongoose.connect(MONGO_URL);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;

  // ── 1. Ensure shareevents collection and indexes ──────────────────────────
  const collections = await db.listCollections({ name: 'shareevents' }).toArray();
  if (collections.length === 0) {
    await db.createCollection('shareevents');
    console.log('Created collection: shareevents');
  } else {
    console.log('Collection shareevents already exists');
  }

  const shareCollection = db.collection('shareevents');
  await shareCollection.createIndex({ shareId: 1 }, { unique: true, sparse: true });
  await shareCollection.createIndex({ primaryId: 1, dayKey: 1 });
  await shareCollection.createIndex({ dayKey: 1 });
  console.log('ShareEvent indexes ensured');

  // ── 2. Ensure player indexes ──────────────────────────────────────────────
  const playersCollection = db.collection('players');
  await playersCollection.createIndex(
    { referralCode: 1 },
    { unique: true, sparse: true, background: true }
  );
  await playersCollection.createIndex(
    { xUserId: 1 },
    { unique: true, sparse: true, background: true }
  );
  await playersCollection.createIndex(
    { referredBy: 1 },
    { sparse: true, background: true }
  );
  console.log('Player indexes ensured');

  // ── 3. Backfill referralCode for existing players ─────────────────────────
  const playersWithoutCode = await playersCollection
    .find({ referralCode: { $exists: false } })
    .toArray();

  console.log(`Players without referralCode: ${playersWithoutCode.length}`);

  let updated = 0;
  let skipped = 0;

  for (const player of playersWithoutCode) {
    let assigned = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generateReferralCode();
      try {
        await playersCollection.updateOne(
          { _id: player._id, referralCode: { $exists: false } },
          { $set: { referralCode: code } }
        );
        assigned = true;
        break;
      } catch (err) {
        if (err.code === 11000) {
          // Duplicate key — try another code
          continue;
        }
        throw err;
      }
    }

    if (assigned) {
      updated++;
    } else {
      console.warn(`Could not assign referralCode to player ${player._id} after 10 attempts`);
      skipped++;
    }
  }

  console.log(`Backfilled referralCode: updated=${updated}, skipped=${skipped}`);

  // ── 4. Summary ────────────────────────────────────────────────────────────
  const totalPlayers = await playersCollection.countDocuments();
  const withCode = await playersCollection.countDocuments({
    referralCode: { $exists: true, $ne: null }
  });
  const shareEventCount = await shareCollection.countDocuments();

  console.log(`\nSummary:`);
  console.log(`  Total players:        ${totalPlayers}`);
  console.log(`  With referralCode:    ${withCode}`);
  console.log(`  Total share events:   ${shareEventCount}`);

  await mongoose.disconnect();
  console.log('\nMigration complete.');
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
