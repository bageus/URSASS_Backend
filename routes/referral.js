const express = require('express');
const router = express.Router();
const Player = require('../models/Player');
const { readLimiter } = require('../middleware/rateLimiter');
const { requireAuth } = require('../middleware/requireAuth');
const logger = require('../utils/logger');

/**
 * POST /api/referral/track
 * Record that the current player was referred by a referral code.
 * Auth required. Rate-limited.
 */
router.post('/track', readLimiter, requireAuth, async (req, res) => {
  try {
    const { ref } = req.body;
    const primaryId = req.primaryId;

    if (!ref || typeof ref !== 'string') {
      return res.status(400).json({ error: 'Missing ref code' });
    }

    const refCode = ref.trim().toUpperCase();

    const currentPlayer = await Player.findOne({ wallet: primaryId });
    if (!currentPlayer) {
      return res.status(404).json({ error: 'Player not found' });
    }

    if (currentPlayer.referredBy) {
      return res.status(200).json({ already: true });
    }

    if (currentPlayer.referralCode && currentPlayer.referralCode === refCode) {
      return res.status(400).json({ error: 'Cannot use your own referral code' });
    }

    const referrer = await Player.findOne({ referralCode: refCode });
    if (!referrer) {
      return res.status(404).json({ error: 'Referral code not found' });
    }

    // Atomic: only set if referredBy is still null
    const updated = await Player.findOneAndUpdate(
      { wallet: primaryId, referredBy: null },
      { $set: { referredBy: refCode } },
      { new: true }
    );

    if (!updated) {
      // Race: another request already set it
      return res.status(200).json({ already: true });
    }

    logger.info({ primaryId, refCode }, 'Referral tracked');

    return res.json({ success: true, referredBy: refCode });
  } catch (err) {
    logger.error({ err: err.message }, 'POST /api/referral/track error');
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
