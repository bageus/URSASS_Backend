const express = require('express');
const router = express.Router();
const Player = require('../models/Player');
const ReferralReward = require('../models/ReferralReward');
const { grantGoldReward } = require('../utils/goldRewards');
const { readLimiter, writeLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');
const { requireAuth } = require('../middleware/requireAuth');

/**
 * POST /api/referral/track
 * Attach a referralCode (referredBy) to the current player.
 * Rewards are NOT granted here — they happen after the first valid run.
 */
router.post('/track', writeLimiter, requireAuth, async (req, res) => {
  try {
    const currentPrimaryId = req.primaryId;
    const ref = String(req.body?.ref || '').trim().toUpperCase();

    if (!ref) {
      return res.status(400).json({ error: 'Missing ref parameter' });
    }

    const currentPlayer = await Player.findOne({ wallet: currentPrimaryId });
    if (!currentPlayer) {
      return res.status(404).json({ error: 'Player not found. Play at least one game first.' });
    }

    // Already has a referral — idempotent
    if (currentPlayer.referredBy) {
      return res.status(200).json({ already: true });
    }

    // Cannot refer yourself
    if (currentPlayer.referralCode === ref) {
      return res.status(400).json({ error: 'Cannot use your own referral code' });
    }

    // Find the referrer by code
    const referrer = await Player.findOne({ referralCode: ref });
    if (!referrer) {
      return res.status(404).json({ error: 'Referral code not found' });
    }

    // Atomically set referredBy only if it is still null (prevent race)
    const updated = await Player.findOneAndUpdate(
      { wallet: currentPrimaryId, referredBy: null },
      { $set: { referredBy: ref } },
      { new: true }
    );

    if (!updated) {
      // Another request set it first — idempotent
      return res.status(200).json({ already: true });
    }

    logger.info({ primaryId: currentPrimaryId, ref }, 'Referral code tracked');

    return res.json({ success: true, referredBy: ref });

  } catch (error) {
    logger.error({ err: error }, 'POST /referral/track error');
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/apply', writeLimiter, requireAuth, async (req, res) => {
  try {
    const currentPrimaryId = String(req.primaryId || '').trim().toLowerCase();
    const referralCode = String(req.body?.referralCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{1,64}$/.test(referralCode)) {
      return res.status(400).json({ error: 'invalid_referral_code' });
    }

    const currentPlayer = await Player.findOne({ wallet: currentPrimaryId });
    if (!currentPlayer) return res.status(404).json({ error: 'player_not_found' });
    if (currentPlayer.referralCode === referralCode) {
      return res.status(400).json({ error: 'cannot_use_own_referral_code' });
    }

    const referrer = await Player.findOne({ referralCode });
    if (!referrer) return res.status(404).json({ error: 'referral_code_not_found' });
    const referrerPrimaryId = String(referrer.wallet || '').trim().toLowerCase();

    if (referrerPrimaryId && referrerPrimaryId === currentPrimaryId) {
      return res.status(400).json({ error: 'cannot_use_own_referral_code' });
    }

    let reward = await ReferralReward.findOne({ referredPrimaryId: currentPrimaryId });
    let repairedPartial = false;
    if (!reward) {
      reward = await ReferralReward.create({
        referredPrimaryId: currentPrimaryId,
        referrerPrimaryId,
        referralCode,
        referredGoldAwarded: 100,
        referrerGoldAwarded: 50
      });
    } else {
      repairedPartial = true;
      if (reward.referralCode !== referralCode) {
        return res.status(409).json({ error: 'referral_already_applied', alreadyApplied: true });
      }
    }

    const op = {
      referredBalance: !!reward.referredBalanceCreditedAt,
      referrerBalance: !!reward.referrerBalanceCreditedAt,
      referredHistory: !!reward.referredHistoryRecordedAt,
      referrerHistory: !!reward.referrerHistoryRecordedAt,
      referredBy: false
    };

    if (!reward.referredBalanceCreditedAt || !reward.referredHistoryRecordedAt) {
      const referredReward = await grantGoldReward(currentPrimaryId, 100, 'referral', `referral:${reward._id}:referred`);
      if (!referredReward.history || referredReward.balance === null) throw new Error('failed_referred_reward');
      reward.referredBalanceCreditedAt = reward.referredBalanceCreditedAt || new Date();
      reward.referredHistoryRecordedAt = reward.referredHistoryRecordedAt || new Date();
      op.referredBalance = true;
      op.referredHistory = true;
    }

    if (!reward.referrerBalanceCreditedAt || !reward.referrerHistoryRecordedAt) {
      const referrerReward = await grantGoldReward(referrerPrimaryId, 50, 'refer', `referral:${reward._id}:referrer`);
      if (!referrerReward.history || referrerReward.balance === null) throw new Error('failed_referrer_reward');
      reward.referrerBalanceCreditedAt = reward.referrerBalanceCreditedAt || new Date();
      reward.referrerHistoryRecordedAt = reward.referrerHistoryRecordedAt || new Date();
      op.referrerBalance = true;
      op.referrerHistory = true;
    }

    await Player.updateOne({ wallet: currentPrimaryId }, { $set: { referredBy: referralCode } });
    op.referredBy = true;

    reward.appliedAt = new Date();
    await reward.save();

    const refreshed = await Player.findOne({ wallet: currentPrimaryId });
    logger.info({ currentPrimaryId, referrerPrimaryId, referralCode, repairedPartial, ...op }, 'Referral apply completed');

    return res.json({
      applied: true,
      referralCode,
      referredGoldAwarded: 100,
      referrerGoldAwarded: 50,
      totalGold: refreshed?.gold || 0
    });
  } catch (error) {
    logger.error({ err: error }, 'POST /referral/apply error');
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
