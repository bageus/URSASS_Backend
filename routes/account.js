const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const {
  getOrCreateTelegramAccount,
  getOrCreateWalletAccount,
  linkAccounts,
  resolvePrimaryId
} = require('../utils/accountManager');
const { verifySignature } = require('../utils/verifySignature');
const { readLimiter, writeLimiter, verifyTelegramLimiter } = require('../middleware/rateLimiter');
const Player = require('../models/Player');
const AccountLink = require('../models/AccountLink');
const LinkCode = require('../models/LinkCode');
const logger = require('../utils/logger');
const { normalizeWallet, validateTimestampWindow } = require('../utils/security');
const { validateTelegramInitData } = require('../utils/telegramAuth');
const { computeRank } = require('../services/leaderboardInsightsService');
const { buildReferralUrl } = require('../utils/referral');
const { getUtcDayKey, getYesterdayUtcDayKey } = require('../utils/utcDay');
const { findLink } = require('../middleware/requireAuth');

const WALLET_TIMESTAMP_WINDOW_MS = Number(process.env.WALLET_AUTH_TIMESTAMP_WINDOW_MS || 10 * 60 * 1000);

function resolveTelegramInitData(req) {
  return req.body?.telegramInitData
    || req.body?.initData
    || req.get('x-telegram-init-data')
    || '';
}

/**
 * Generate a random link code like "BEAR-A3F9K2"
 */
function generateLinkCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(crypto.randomInt(chars.length));
  }
  return code;
}

/**
 * POST /api/account/auth/telegram
 */
router.post('/auth/telegram', readLimiter, async (req, res) => {
  try {
    const initData = resolveTelegramInitData(req);
    const validation = validateTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN);

    if (!validation.valid) {
      return res.status(401).json({ error: validation.error });
    }

    const telegramId = String(validation.user.id);
    const firstName = validation.user.first_name || null;
    const username = validation.user.username || null;

    const account = await getOrCreateTelegramAccount(telegramId);

    logger.info({ telegramId, displayName: firstName || username || 'anon', primaryId: account.primaryId }, 'Telegram auth');

    res.json({
      success: true,
      primaryId: account.primaryId,
      telegramId: account.telegramId,
      wallet: account.wallet,
      isLinked: account.isLinked,
      displayName: firstName || username || `TG#${telegramId}`
    });

  } catch (error) {
    logger.error({ err: error }, 'POST /auth/telegram error');
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/account/auth/wallet
 */
router.post('/auth/wallet', readLimiter, async (req, res) => {
  try {
    const { wallet, signature, timestamp } = req.body;

    if (!wallet || !signature || !timestamp) {
      return res.status(400).json({ error: 'Missing wallet, signature, or timestamp' });
    }

    const timestampValidation = validateTimestampWindow(timestamp, { windowMs: WALLET_TIMESTAMP_WINDOW_MS });
    if (!timestampValidation.valid) {
      return res.status(400).json({ error: timestampValidation.error });
    }

    const { normalizedTs } = timestampValidation;

    const walletLower = normalizeWallet(wallet);

    const message = `Auth wallet\nWallet: ${walletLower}\nTimestamp: ${normalizedTs}`;
    const isValid = verifySignature(message, signature, walletLower);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const account = await getOrCreateWalletAccount(walletLower);

    // Look up the full AccountLink to get telegramUsername
    const link = await AccountLink.findOne({ primaryId: account.primaryId });

    logger.info({ wallet: walletLower, primaryId: account.primaryId }, 'Wallet auth');

    res.json({
      success: true,
      primaryId: account.primaryId,
      telegramId: account.telegramId,
      telegramUsername: link ? link.telegramUsername : null,
      wallet: account.wallet,
      isLinked: account.isLinked
    });

  } catch (error) {
    logger.error({ err: error }, 'POST /auth/wallet error');
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/account/link/request-code
 * Generate a verification code for linking Telegram
 */
router.post('/link/request-code', writeLimiter, async (req, res) => {
  try {
    const { primaryId } = req.body;

    if (!primaryId) {
      return res.status(400).json({ error: 'Missing primaryId' });
    }

    const primaryIdLower = primaryId.toLowerCase();

    const link = await AccountLink.findOne({ primaryId: primaryIdLower });
    if (!link) {
      return res.status(404).json({ error: 'Account not found' });
    }

    if (link.telegramId && link.wallet) {
      return res.status(400).json({ error: 'Account already fully linked' });
    }

    if (!link.wallet) {
      return res.status(400).json({ error: 'Only wallet accounts can link Telegram via code' });
    }

    // Delete old unused codes
    await LinkCode.deleteMany({ primaryId: primaryIdLower, used: false });

    // Generate unique code
    let code;
    let attempts = 0;
    do {
      code = generateLinkCode();
      attempts++;
      if (attempts > 10) {
        return res.status(500).json({ error: 'Failed to generate unique code' });
      }
    } while (await LinkCode.findOne({ code }));

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await new LinkCode({
      primaryId: primaryIdLower,
      code,
      linkType: 'telegram',
      expiresAt
    }).save();

    logger.info({ primaryId: primaryIdLower }, 'Link code generated');

    res.json({
      success: true,
      code,
      expiresInSeconds: 600,
      botUsername: process.env.TELEGRAM_BOT_USERNAME || 'Ursasstube_bot'
    });

  } catch (error) {
    logger.error({ err: error }, 'POST /link/request-code error');
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/account/link/verify-telegram
 * Called by the Telegram bot when user sends a verification code
 */
router.post('/link/verify-telegram', verifyTelegramLimiter, async (req, res) => {
  try {
    const { telegramId, code, botSecret } = req.body;

    if (!telegramId || !code) {
      return res.status(400).json({ error: 'Missing telegramId or code' });
    }

    const expectedSecret = process.env.TELEGRAM_BOT_SECRET;
    if (!expectedSecret) {
      return res.status(503).json({ error: 'Telegram bot secret is not configured' });
    }

    if (expectedSecret && botSecret !== expectedSecret) {
      return res.status(401).json({ error: 'Invalid bot secret' });
    }

    const codeUpper = code.toUpperCase().trim();
    const tgIdStr = String(telegramId);

    const linkCode = await LinkCode.findOne({ code: codeUpper, used: false });

    if (!linkCode) {
      return res.status(404).json({
        success: false,
        error: 'Code not found or already used'
      });
    }

    if (new Date() > linkCode.expiresAt) {
      await LinkCode.deleteOne({ _id: linkCode._id });
      return res.status(400).json({
        success: false,
        error: 'Code expired. Please request a new one.'
      });
    }

    linkCode.used = true;
    await linkCode.save();

    const result = await linkAccounts(linkCode.primaryId, 'telegram', tgIdStr);

    if (result.success) {
      logger.info({ telegramId: tgIdStr, primaryId: linkCode.primaryId }, 'Telegram linked via bot');
    } else {
      logger.warn({ telegramId: tgIdStr, primaryId: linkCode.primaryId, error: result.error }, 'Telegram link failed');
    }

    res.json(result);

  } catch (error) {
    logger.error({ err: error }, 'POST /link/verify-telegram error');
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/account/link/wallet
 * Link Wallet to an existing Telegram account
 */
router.post('/link/wallet', writeLimiter, async (req, res) => {
  try {
    const { primaryId, wallet, signature, timestamp } = req.body;

    if (!primaryId || !wallet || !signature || !timestamp) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const timestampValidation = validateTimestampWindow(timestamp, { windowMs: WALLET_TIMESTAMP_WINDOW_MS });
    if (!timestampValidation.valid) {
      return res.status(400).json({ error: timestampValidation.error });
    }

    const { normalizedTs } = timestampValidation;

    const walletLower = normalizeWallet(wallet);

    const message = `Link wallet\nWallet: ${walletLower}\nPrimaryId: ${primaryId}\nTimestamp: ${normalizedTs}`;
    const isValid = verifySignature(message, signature, walletLower);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const result = await linkAccounts(primaryId, 'wallet', walletLower);
    res.json(result);

  } catch (error) {
    logger.error({ err: error }, 'POST /link/wallet error');
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/account/info/:identifier
 */
router.get('/info/:identifier', readLimiter, async (req, res) => {
  try {
    const identifier = req.params.identifier;

    const resolvedId = await resolvePrimaryId(identifier);
    if (!resolvedId) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const link = await AccountLink.findOne({ primaryId: resolvedId });
    const player = await Player.findOne({ wallet: resolvedId });

    res.json({
      primaryId: link.primaryId,
      telegramId: link.telegramId,
      wallet: link.wallet,
      isLinked: !!(link.telegramId && link.wallet),
      linkedAt: link.linkedAt,
      bestScore: player ? player.bestScore : 0,
      gamesPlayed: player ? player.gamesPlayed : 0
    });

  } catch (error) {
    logger.error({ err: error }, 'GET /info error');
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/account/me/profile
 * Returns full player profile including rank, referral info, share streak.
 * Auth: X-Primary-Id or X-Wallet header (both fields tried, with cross-field fallback).
 */
router.get('/me/profile', readLimiter, async (req, res) => {
  try {
    const rawPrimaryId = (req.get('x-primary-id') || '').trim().toLowerCase();
    const rawWallet = (req.get('x-wallet') || '').trim().toLowerCase();
    const initData = req.get('x-telegram-init-data') || req.get('X-Telegram-Init-Data') || '';

    if (!rawPrimaryId && !rawWallet && !initData) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const link = await findLink(rawPrimaryId, rawWallet, initData);
    if (!link || link.__invalid) {
      return res.status(401).json({ error: 'Account not found' });
    }

    const primaryId = link.primaryId;
    const player = await Player.findOne({ wallet: primaryId });
    if (!player) {
      return res.status(404).json({ error: 'Player not found. Play at least one game first.' });
    }

    const { rank, totalRankedPlayers } = await computeRank(player.bestScore || 0);
    const referralUrl = buildReferralUrl(player.referralCode || '', req);

    const today = getUtcDayKey();
    const yesterday = getYesterdayUtcDayKey();

    const canShareToday = player.lastShareDay !== today;

    // For display: if streak is stale (missed yesterday), show 0 without mutating DB
    const displayShareStreak =
      player.lastShareDay && player.lastShareDay < yesterday
        ? 0
        : player.shareStreak || 0;

    return res.json({
      primaryId,
      rank: rank || null,
      totalRankedPlayers: totalRankedPlayers || 0,
      bestScore: player.bestScore || 0,
      gold: player.gold || 0,
      referralCode: player.referralCode || null,
      referralUrl,
      telegram: {
        connected: Boolean(link.telegramId),
        username: link.telegramUsername || null,
        id: link.telegramId || null
      },
      wallet: {
        connected: Boolean(link.wallet),
        address: link.wallet || null
      },
      x: {
        connected: Boolean(player.xUserId),
        username: player.xUsername || null
      },
      shareStreak: displayShareStreak,
      canShareToday,
      goldRewardToday: Number(process.env.SHARE_DAILY_REWARD_GOLD || 20),
      lastShareDay: player.lastShareDay || null
    });

  } catch (error) {
    logger.error({ err: error }, 'GET /me/profile error');
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
