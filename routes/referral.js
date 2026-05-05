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

    const currentPrimaryId = link.primaryId;
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

    try {
      await ReferralReward.create({
        referredPrimaryId: currentPrimaryId,
        referrerPrimaryId: referrer.wallet,
        referralCode,
        referredGoldAwarded: 100,
        referrerGoldAwarded: 50
      });
    } catch (e) {
      if (e?.code === 11000) return res.status(409).json({ error: 'referral_already_applied', alreadyApplied: true });
      throw e;
    }

    await Player.updateOne({ wallet: currentPrimaryId }, { $set: { referredBy: referralCode } });
    await addGold(currentPrimaryId, 100, 'referral_apply_referred');
    await addGold(referrer.wallet, 50, 'referral_apply_referrer');
    await recordCoinReward(currentPrimaryId, 'referral_apply', { gold: 100 });
    await recordCoinReward(referrer.wallet, 'refer_apply', { gold: 50 });
    const refreshed = await Player.findOne({ wallet: currentPrimaryId });

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
