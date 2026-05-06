const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const Player = require('../models/Player');
const ShareEvent = require('../models/ShareEvent');
const AccountLink = require('../models/AccountLink');
const { getUtcDayKey, getYesterdayUtcDayKey } = require('../utils/utcDay');
const { buildWebReferralUrl, buildTelegramReferralUrl } = require('../utils/referral');
const { addGold } = require('../utils/goldWallet');
const { recordCoinReward } = require('../utils/coinHistory');
const logger = require('../utils/logger');

const SHARE_REWARD_DELAY_MS = Number(process.env.SHARE_REWARD_DELAY_MS || 30000);
const SHARE_DAILY_REWARD_GOLD = Number(process.env.SHARE_DAILY_REWARD_GOLD || 20);
function shouldUseXApiShare() {
  return String(process.env.USE_X_API_SHARE || 'false').toLowerCase() === 'true';
}

const SHARE_HASHTAGS = '#UrsassTube #Ursas #Ursasplanet #GameChallenge';

function getClientIp(req) {
  const xff = req.get('x-forwarded-for');
  if (xff && typeof xff === 'string') {
    const first = xff.split(',').map((v) => v.trim()).find(Boolean);
    if (first) return first;
  }
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

const shareStartLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many share start requests. Please wait.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp
});

const shareConfirmLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many share confirm requests. Please wait.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp
});

/**
 * Resolve authenticated primaryId from request headers or body.
 * Returns AccountLink if valid, null otherwise.
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

function getPublicBaseUrl(req) {
  const configured = (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function buildSharePostText(score, referralCode, webShareUrl, telegramShareUrl) {
  const normalizedScore = Math.max(0, Math.floor(Number(score || 0)));
  const parts = [
    `I scored ${normalizedScore} in Ursass Tube 🐻`,
    'Can you beat me?',
    '',
    'Play Web:',
    webShareUrl,
    '',
    'Play Telegram:',
    telegramShareUrl,
    '',
    `Get bonus — use my ref code: ${referralCode}`,
    '',
    SHARE_HASHTAGS
  ];
  return parts.join('\n');
}

/**
 * POST /api/share/start
 * Begin a share flow. Creates a ShareEvent and returns share metadata.
 */
router.post('/start', shareStartLimiter, async (req, res) => {
  try {
    const link = await resolveAuth(req);
    if (!link) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const primaryId = link.primaryId;

    const player = await Player.findOne({ wallet: primaryId });
    if (!player) {
      return res.status(404).json({ error: 'Player not found. Play at least one game first.' });
    }

    const today = getUtcDayKey();
    const canShareToday = player.lastShareDay !== today;
    const scoreAtShare = player.bestScore || 0;
    const baseUrl = getPublicBaseUrl(req);
    const walletAddress = link.wallet || null;
    const referralCode = player.referralCode || '';
    const previewImageUrl = walletAddress
      ? `${baseUrl}/api/leaderboard/share/image/${walletAddress}.png`
      : `${baseUrl}/img/score_result.png`;
    const shareId = crypto.randomUUID();
    const webShareUrl = `${baseUrl}/share/${shareId}`;
    const telegramShareUrl = buildTelegramReferralUrl();
    const postText = buildSharePostText(scoreAtShare, referralCode, webShareUrl, telegramShareUrl);
    const hasConnectedXAccount = Boolean(player.xUserId);
    const shouldUsePaidXApi = shouldUseXApiShare() && hasConnectedXAccount;
    const intentUrl = shouldUsePaidXApi ? null : `https://twitter.com/intent/tweet?text=${encodeURIComponent(postText)}`;

    await ShareEvent.create({
      primaryId,
      wallet: walletAddress,
      shareId,
      startedAt: new Date(),
      createdAt: new Date(),
      scoreAtShare,
      referralCode,
      postText,
      imageUrl: previewImageUrl,
      previewImageUrl,
      webShareUrl,
      telegramShareUrl
    });

    if (!canShareToday) {
      return res.json({
        shareId,
        reason: 'already_shared_today',
        shareUrl: webShareUrl,
        postText,
        imageUrl: previewImageUrl,
        postImageUrl: previewImageUrl,
        previewUrl: webShareUrl,
        intentUrl,
        shareResultApiUrl: '/api/x/share-result',
        preferredShareFlow: shouldUsePaidXApi ? 'x_api' : 'intent',
        eligibleForReward: false,
        secondsUntilReward: 0,
        referralUrl: buildWebReferralUrl(referralCode),
        webShareUrl,
        telegramShareUrl
      });
    }

    logger.info({ primaryId, shareId }, 'Share started');

    return res.json({
      shareId,
      postText,
      referralUrl: buildWebReferralUrl(referralCode),
      telegramShareUrl,
      webShareUrl,
      imageUrl: previewImageUrl,
      postImageUrl: previewImageUrl,
      previewUrl: webShareUrl,
      intentUrl,
      shareResultApiUrl: '/api/x/share-result',
      preferredShareFlow: shouldUsePaidXApi ? 'x_api' : 'intent',

      eligibleForReward: true,
      secondsUntilReward: Math.ceil(SHARE_REWARD_DELAY_MS / 1000)
    });

  } catch (error) {
    logger.error({ err: error }, 'POST /share/start error');
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/share/confirm
 * Confirm a share and award gold if eligible.
 * Uses atomic findOneAndUpdate to prevent double-awarding in race conditions.
 */
router.post('/confirm', shareConfirmLimiter, async (req, res) => {
  try {
    const link = await resolveAuth(req);
    if (!link) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const primaryId = link.primaryId;
    const shareId = String(req.body?.shareId || '').trim();

    if (!shareId) {
      return res.status(400).json({ error: 'Missing shareId' });
    }

    // Find the share event belonging to this player
    const shareEvent = await ShareEvent.findOne({ shareId, primaryId });
    if (!shareEvent) {
      return res.status(404).json({ error: 'Share event not found' });
    }

    // Idempotent: already confirmed
    if (shareEvent.confirmedAt) {
      const player = await Player.findOne({ wallet: primaryId });
      return res.json({
        awarded: shareEvent.goldAwarded > 0,
        goldAwarded: shareEvent.goldAwarded,
        shareStreak: player ? player.shareStreak : 0,
        totalGold: player ? player.gold : 0
      });
    }

    // Too early
    const elapsed = Date.now() - new Date(shareEvent.startedAt).getTime();
    if (elapsed < SHARE_REWARD_DELAY_MS) {
      const secondsLeft = Math.ceil((SHARE_REWARD_DELAY_MS - elapsed) / 1000);
      return res.status(425).json({ error: 'too_early', secondsLeft });
    }

    // Check if another ShareEvent for today already got a reward
    const today = getUtcDayKey();
    const alreadyRewarded = await ShareEvent.findOne({
      primaryId,
      dayKey: today,
      goldAwarded: { $gt: 0 }
    });

    if (alreadyRewarded) {
      // Still mark as confirmed (so confirm won't try again), but no reward
      await ShareEvent.findOneAndUpdate(
        { shareId, primaryId, confirmedAt: null },
        { $set: { confirmedAt: new Date(), dayKey: today } }
      );
      const player = await Player.findOne({ wallet: primaryId });
      return res.json({
        awarded: false,
        reason: 'already_rewarded_today',
        shareStreak: player ? player.shareStreak : 0,
        totalGold: player ? player.gold : 0
      });
    }

    // Atomic confirm — prevent double-awarding in concurrent requests
    const now = new Date();
    const confirmed = await ShareEvent.findOneAndUpdate(
      { shareId, primaryId, confirmedAt: null },
      {
        $set: {
          confirmedAt: now,
          rewardedAt: now,
          goldAwarded: SHARE_DAILY_REWARD_GOLD,
          dayKey: today
        }
      },
      { new: true }
    );

    if (!confirmed) {
      // Another concurrent request already confirmed it
      const shareEventRefreshed = await ShareEvent.findOne({ shareId, primaryId });
      const player = await Player.findOne({ wallet: primaryId });
      return res.json({
        awarded: (shareEventRefreshed?.goldAwarded || 0) > 0,
        goldAwarded: shareEventRefreshed?.goldAwarded || 0,
        shareStreak: player ? player.shareStreak : 0,
        totalGold: player ? player.gold : 0
      });
    }

    // Update player streak and lastShareDay
    const player = await Player.findOne({ wallet: primaryId });
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const yesterday = getYesterdayUtcDayKey();
    if (player.lastShareDay === yesterday) {
      player.shareStreak = (player.shareStreak || 0) + 1;
    } else {
      player.shareStreak = 1;
    }

    player.lastShareDay = today;
    player.lastShareAt = now;
    await player.save();

    // Award gold
    const newGoldBalance = await addGold(primaryId, SHARE_DAILY_REWARD_GOLD, 'share_daily', {
      requestId: req.requestId
    });
    await recordCoinReward(primaryId, 'share', { gold: SHARE_DAILY_REWARD_GOLD }, { requestId: req.requestId });

    logger.info(
      { primaryId, shareId, goldAwarded: SHARE_DAILY_REWARD_GOLD, shareStreak: player.shareStreak },
      'Share confirmed and rewarded'
    );

    return res.json({
      awarded: true,
      goldAwarded: SHARE_DAILY_REWARD_GOLD,
      shareStreak: player.shareStreak,
      totalGold: newGoldBalance !== null ? newGoldBalance : player.gold
    });

  } catch (error) {
    logger.error({ err: error }, 'POST /share/confirm error');
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
