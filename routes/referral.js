const express = require('express');
const router = express.Router();
const Player = require('../models/Player');
const AccountLink = require('../models/AccountLink');
const ReferralReward = require('../models/ReferralReward');
const { addGold } = require('../utils/goldWallet');
const { recordCoinReward } = require('../utils/coinHistory');
const { readLimiter, writeLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');

/**
 * Resolve the authenticated primaryId from the request.
 * Accepts X-Primary-Id header or body.primaryId.
 * Returns the AccountLink if valid, null otherwise.
 */
async function resolveAuth(req) {
  const primaryId = (
    req.get('x-primary-id') ||
    req.get('X-Primary-Id') ||
    req.body?.primaryId ||
    ''
  ).trim().toLowerCase();

  if (!primaryId) return null;

  const link = await AccountLink.findOne({ primaryId });
  if (!link) return null;

  return link;
}

/**
 * POST /api/referral/track
 * Attach a referralCode (referredBy) to the current player.
 * Rewards are NOT granted here — they happen after the first valid run.
 */
router.post('/track', writeLimiter, async (req, res) => {
  try {
    const link = await resolveAuth(req);
    if (!link) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const currentPrimaryId = link.primaryId;
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

router.post('/apply', writeLimiter, async (req, res) => {
  try {
    const link = await resolveAuth(req);
    if (!link) return res.status(401).json({ error: 'authentication_required' });

    const currentPrimaryId = String(link.primaryId || '').trim().toLowerCase();
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

    if (!reward.referredBalanceCreditedAt) {
      const bal = await addGold(currentPrimaryId, 100, 'referral_apply_referred');
      if (bal === null) throw new Error('failed_referred_balance_credit');
      reward.referredBalanceCreditedAt = new Date();
      op.referredBalance = true;
    }

    if (!reward.referrerBalanceCreditedAt) {
      const bal = await addGold(referrerPrimaryId, 50, 'referral_apply_referrer');
      if (bal === null) throw new Error('failed_referrer_balance_credit');
      reward.referrerBalanceCreditedAt = new Date();
      op.referrerBalance = true;
    }

    if (!reward.referredHistoryRecordedAt) {
      const entry = await recordCoinReward(currentPrimaryId, 'referral', { gold: 100 }, { contextKey: `referral:${reward._id}:referred` });
      if (!entry) throw new Error('failed_referred_history');
      reward.referredHistoryRecordedAt = new Date();
      op.referredHistory = true;
    }

    if (!reward.referrerHistoryRecordedAt) {
      const entry = await recordCoinReward(referrerPrimaryId, 'refer', { gold: 50 }, { contextKey: `referral:${reward._id}:referrer` });
      if (!entry) throw new Error('failed_referrer_history');
      reward.referrerHistoryRecordedAt = new Date();
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
