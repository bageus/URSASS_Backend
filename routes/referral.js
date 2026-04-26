const express = require('express');
const router = express.Router();
const Player = require('../models/Player');
const AccountLink = require('../models/AccountLink');
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

module.exports = router;
