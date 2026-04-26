const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Player = require('../models/Player');
const ShareEvent = require('../models/ShareEvent');
const { shareStartLimiter, shareConfirmLimiter } = require('../middleware/rateLimiter');
const { requireAuth } = require('../middleware/requireAuth');
const { getUtcDayKey, getYesterdayUtcDayKey } = require('../utils/utcDay');
const { buildReferralUrl } = require('../utils/referral');
const { addGold } = require('../utils/goldWallet');
const logger = require('../utils/logger');

const SHARE_REWARD_DELAY_MS = Number(process.env.SHARE_REWARD_DELAY_MS || 30000);
const SHARE_DAILY_REWARD_GOLD = Number(process.env.SHARE_DAILY_REWARD_GOLD || 20);

function getPublicBaseUrl(req) {
  const configured = (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  return `${req.protocol}://${req.get('host')}`;
}

const SHARE_COPY_TEMPLATE = 'I scored {score} in Ursass Tube 🐻\nCan you beat me?';
const SHARE_HASHTAGS = '#UrsassTube #Ursas #Ursasplanet #GameChallenge #HighScore';

function buildSharePostText(score, referralUrl) {
  const normalizedScore = Math.max(0, Math.floor(Number(score || 0)));
  const main = SHARE_COPY_TEMPLATE.replace('{score}', normalizedScore);
  const parts = [main, referralUrl ? referralUrl.trim() : '', SHARE_HASHTAGS].filter(Boolean);
  return parts.join('\n');
}

/**
 * POST /api/share/start
 * Begin a share session. Returns share payload.
 * Auth required.
 */
router.post('/start', shareStartLimiter, requireAuth, async (req, res) => {
  try {
    const primaryId = req.primaryId;
    const link = req.authLink;

    const player = await Player.findOne({ wallet: primaryId });
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const today = getUtcDayKey();
    const canShareToday = player.lastShareDay !== today;

    const referralUrl = player.referralCode
      ? buildReferralUrl(player.referralCode, req)
      : buildReferralUrl('', req).replace('/?ref=', '/');

    const postText = buildSharePostText(player.bestScore || 0, player.referralCode ? referralUrl : '');

    const baseUrl = getPublicBaseUrl(req);
    const wallet = link.wallet;
    const imageUrl = wallet
      ? `${baseUrl}/api/leaderboard/share/image/${wallet}.png`
      : `${baseUrl}/api/leaderboard/share/image/${primaryId.replace('tg_', '')}.svg`;

    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(postText)}`;

    if (!canShareToday) {
      return res.json({
        shareId: null,
        reason: 'already_shared_today',
        shareUrl: referralUrl,
        postText,
        imageUrl,
        eligibleForReward: false,
        secondsUntilReward: 0,
        intentUrl
      });
    }

    const shareId = crypto.randomUUID();
    const now = new Date();

    await ShareEvent.create({
      primaryId,
      wallet: wallet || null,
      shareId,
      startedAt: now,
      scoreAtShare: player.bestScore || 0,
      postText,
      imageUrl
    });

    logger.info({ primaryId, shareId }, 'Share session started');

    return res.json({
      shareId,
      postText,
      referralUrl,
      imageUrl,
      intentUrl,
      eligibleForReward: true,
      secondsUntilReward: Math.ceil(SHARE_REWARD_DELAY_MS / 1000)
    });
  } catch (err) {
    logger.error({ err: err.message }, 'POST /api/share/start error');
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/share/confirm
 * Confirm a share session and award gold if eligible.
 * Auth required.
 */
router.post('/confirm', shareConfirmLimiter, requireAuth, async (req, res) => {
  try {
    const { shareId } = req.body;
    const primaryId = req.primaryId;

    if (!shareId) {
      return res.status(400).json({ error: 'Missing shareId' });
    }

    // Atomic: find and lock the event so only one confirm wins
    const event = await ShareEvent.findOneAndUpdate(
      { shareId, primaryId, confirmedAt: null },
      { $set: { confirmedAt: new Date() } },
      { new: false }
    );

    if (!event) {
      // Either not found or already confirmed
      const existing = await ShareEvent.findOne({ shareId, primaryId });
      if (!existing) {
        return res.status(404).json({ error: 'Share event not found' });
      }
      // Already confirmed — return idempotent result
      const player = await Player.findOne({ wallet: primaryId });
      return res.json({
        awarded: existing.goldAwarded > 0,
        goldAwarded: existing.goldAwarded,
        shareStreak: player ? player.shareStreak : 0,
        totalGold: player ? player.gold : 0
      });
    }

    // event is the pre-update doc (confirmedAt was null)
    const now = Date.now();
    const elapsed = now - new Date(event.startedAt).getTime();

    if (elapsed < SHARE_REWARD_DELAY_MS) {
      // Undo the confirmedAt we just set
      await ShareEvent.findOneAndUpdate({ shareId, primaryId }, { $set: { confirmedAt: null } });
      const secondsLeft = Math.ceil((SHARE_REWARD_DELAY_MS - elapsed) / 1000);
      return res.status(425).json({ error: 'too_early', secondsLeft });
    }

    const today = getUtcDayKey();

    // Check if another ShareEvent already rewarded today
    const alreadyRewardedToday = await ShareEvent.findOne({
      primaryId,
      dayKey: today,
      goldAwarded: { $gt: 0 },
      shareId: { $ne: shareId }
    });

    if (alreadyRewardedToday) {
      await ShareEvent.findOneAndUpdate(
        { shareId, primaryId },
        { $set: { dayKey: today } }
      );
      return res.json({ awarded: false, reason: 'already_rewarded_today' });
    }

    const player = await Player.findOne({ wallet: primaryId });
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const yesterday = getYesterdayUtcDayKey();
    let newStreak;
    if (player.lastShareDay === yesterday) {
      newStreak = (player.shareStreak || 0) + 1;
    } else {
      newStreak = 1;
    }

    // Update player
    player.shareStreak = newStreak;
    player.lastShareDay = today;
    player.lastShareAt = new Date();
    await player.save();

    // Award gold
    const newGoldBalance = await addGold(primaryId, SHARE_DAILY_REWARD_GOLD, 'share_daily');

    // Finalize the ShareEvent
    await ShareEvent.findOneAndUpdate(
      { shareId, primaryId },
      {
        $set: {
          dayKey: today,
          goldAwarded: SHARE_DAILY_REWARD_GOLD,
          rewardedAt: new Date()
        }
      }
    );

    logger.info(
      { primaryId, shareId, goldAwarded: SHARE_DAILY_REWARD_GOLD, shareStreak: newStreak },
      'Share confirmed and gold awarded'
    );

    return res.json({
      awarded: true,
      goldAwarded: SHARE_DAILY_REWARD_GOLD,
      shareStreak: newStreak,
      totalGold: newGoldBalance
    });
  } catch (err) {
    logger.error({ err: err.message }, 'POST /api/share/confirm error');
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
