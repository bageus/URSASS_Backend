#!/usr/bin/env node
'use strict';

/**
 * Repair/backfill script for referral rewards.
 *
 * By default this script is DRY-RUN and only prints what would be fixed.
 * Use --apply to persist changes.
 *
 * Usage:
 *   MONGO_URL='mongodb://...' node scripts/repair-referral-rewards.js
 *   MONGO_URL='mongodb://...' node scripts/repair-referral-rewards.js --apply
 */

require('dotenv').config();
const mongoose = require('mongoose');

const ReferralReward = require('../models/ReferralReward');
const CoinTransaction = require('../models/CoinTransaction');
const { addGold } = require('../utils/goldWallet');
const { recordCoinReward } = require('../utils/coinHistory');

const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI;
const APPLY = process.argv.includes('--apply');

const EXPECTED_REFERRED_GOLD = 100;
const EXPECTED_REFERRER_GOLD = 50;

function normalizeId(value) {
  return String(value || '').trim().toLowerCase();
}

async function hasHistory(primaryId, type, amount, contextKey) {
  if (contextKey) {
    const exact = await CoinTransaction.findOne({ contextKey });
    if (exact) return true;
  }

  const fallback = await CoinTransaction.findOne({
    primaryId,
    type,
    gold: amount,
    silver: 0
  });

  return !!fallback;
}

async function run() {
  if (!MONGO_URL) {
    console.error('ERROR: MONGO_URL (or MONGODB_URI) is required');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URL);
  console.log(`Connected to MongoDB. Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  const stats = {
    scanned: 0,
    healthy: 0,
    repairedBalances: 0,
    repairedHistory: 0,
    skippedInvalid: 0,
    errors: 0
  };

  const rewards = await ReferralReward.find({}).sort({ createdAt: 1 });

  for (const reward of rewards) {
    stats.scanned += 1;

    try {
      const referredPrimaryId = normalizeId(reward.referredPrimaryId);
      const referrerPrimaryId = normalizeId(reward.referrerPrimaryId);
      const referralCode = String(reward.referralCode || '').trim().toUpperCase();

      if (!referredPrimaryId || !referrerPrimaryId || !referralCode) {
        stats.skippedInvalid += 1;
        console.warn(`[SKIP INVALID] reward=${reward._id} referred=${referredPrimaryId} referrer=${referrerPrimaryId} code=${referralCode}`);
        continue;
      }

      const referredBalanceCredited = !!reward.referredBalanceCreditedAt;
      const referrerBalanceCredited = !!reward.referrerBalanceCreditedAt;
      const referredCtx = `referral:${reward._id}:referred`;
      const referrerCtx = `referral:${reward._id}:referrer`;

      const referredHistoryExists = await hasHistory(referredPrimaryId, 'referral', EXPECTED_REFERRED_GOLD, referredCtx);
      const referrerHistoryExists = await hasHistory(referrerPrimaryId, 'refer', EXPECTED_REFERRER_GOLD, referrerCtx);

      let changedBalance = false;
      let changedHistory = false;

      if (!referredBalanceCredited) {
        if (APPLY) {
          const bal = await addGold(referredPrimaryId, EXPECTED_REFERRED_GOLD, 'referral_repair_referred');
          if (bal === null) throw new Error('failed_repair_referred_balance');
          reward.referredBalanceCreditedAt = new Date();
        }
        changedBalance = true;
        console.log(`[REPAIR BALANCE] reward=${reward._id} target=referred +${EXPECTED_REFERRED_GOLD}`);
      }

      if (!referrerBalanceCredited) {
        if (APPLY) {
          const bal = await addGold(referrerPrimaryId, EXPECTED_REFERRER_GOLD, 'referral_repair_referrer');
          if (bal === null) throw new Error('failed_repair_referrer_balance');
          reward.referrerBalanceCreditedAt = new Date();
        }
        changedBalance = true;
        console.log(`[REPAIR BALANCE] reward=${reward._id} target=referrer +${EXPECTED_REFERRER_GOLD}`);
      }

      if (!referredHistoryExists || !reward.referredHistoryRecordedAt) {
        if (APPLY) {
          const entry = await recordCoinReward(referredPrimaryId, 'referral', { gold: EXPECTED_REFERRED_GOLD }, { contextKey: referredCtx });
          if (!entry) throw new Error('failed_repair_referred_history');
          reward.referredHistoryRecordedAt = reward.referredHistoryRecordedAt || new Date();
        }
        changedHistory = true;
        console.log(`[REPAIR HISTORY] reward=${reward._id} target=referred type=referral gold=${EXPECTED_REFERRED_GOLD}`);
      }

      if (!referrerHistoryExists || !reward.referrerHistoryRecordedAt) {
        if (APPLY) {
          const entry = await recordCoinReward(referrerPrimaryId, 'refer', { gold: EXPECTED_REFERRER_GOLD }, { contextKey: referrerCtx });
          if (!entry) throw new Error('failed_repair_referrer_history');
          reward.referrerHistoryRecordedAt = reward.referrerHistoryRecordedAt || new Date();
        }
        changedHistory = true;
        console.log(`[REPAIR HISTORY] reward=${reward._id} target=referrer type=refer gold=${EXPECTED_REFERRER_GOLD}`);
      }

      if (changedBalance || changedHistory) {
        if (APPLY) {
          reward.appliedAt = reward.appliedAt || new Date();
          await reward.save();
        }
        if (changedBalance) stats.repairedBalances += 1;
        if (changedHistory) stats.repairedHistory += 1;
      } else {
        stats.healthy += 1;
      }
    } catch (error) {
      stats.errors += 1;
      console.error(`[ERROR] reward=${reward._id} message=${error.message}`);
    }
  }

  console.log('\n=== Referral reward repair summary ===');
  console.log(`Total scanned:       ${stats.scanned}`);
  console.log(`Fully healthy:       ${stats.healthy}`);
  console.log(`Repaired balances:   ${stats.repairedBalances}`);
  console.log(`Repaired history:    ${stats.repairedHistory}`);
  console.log(`Skipped invalid:     ${stats.skippedInvalid}`);
  console.log(`Errors:              ${stats.errors}`);
  console.log(`Mode:                ${APPLY ? 'APPLY (changes persisted)' : 'DRY-RUN (no changes persisted)'}`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
