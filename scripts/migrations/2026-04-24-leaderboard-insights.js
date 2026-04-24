/* eslint-disable no-console */
/**
 * Migration: create run-history + leaderboard insight indexes.
 *
 * Usage:
 *   MONGO_URI='mongodb://localhost:27017/ursass' node scripts/migrations/2026-04-24-leaderboard-insights.js
 */
const mongoose = require('mongoose');

async function run() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(mongoUri);
  const db = mongoose.connection.db;

  await db.createCollection('playerruns').catch((err) => {
    if (err.codeName !== 'NamespaceExists') throw err;
  });

  await db.collection('playerruns').createIndexes([
    { key: { runId: 1 }, name: 'runId_1', unique: true },
    { key: { playerId: 1 }, name: 'playerId_1' },
    { key: { wallet: 1, createdAt: -1 }, name: 'wallet_1_createdAt_-1' },
    { key: { isFirstRun: 1, score: -1 }, name: 'isFirstRun_1_score_-1' },
    { key: { isFirstRun: 1, distance: -1 }, name: 'isFirstRun_1_distance_-1' },
    { key: { isFirstRun: 1, goldCoins: -1, silverCoins: -1 }, name: 'isFirstRun_1_goldCoins_-1_silverCoins_-1' },
    { key: { verified: 1, isValid: 1, createdAt: -1 }, name: 'verified_1_isValid_1_createdAt_-1' }
  ]);

  await db.collection('players').createIndex({ bestScore: -1 }, { name: 'bestScore_-1' });
  await db.createCollection('leaderboardaggregates').catch((err) => {
    if (err.codeName !== 'NamespaceExists') throw err;
  });
  await db.collection('leaderboardaggregates').createIndexes([
    { key: { key: 1 }, name: 'key_1', unique: true },
    { key: { refreshedAt: -1 }, name: 'refreshedAt_-1' }
  ]);

  console.log('Migration completed: leaderboard insights structures are ready.');
  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('Migration failed:', err.message);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
