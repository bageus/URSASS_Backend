const express = require('express');
const router = express.Router();
const {
  getOrCreateTelegramAccount,
  getOrCreateWalletAccount,
  linkAccounts,
  resolvePrimaryId
} = require('../utils/accountManager');
const { verifySignature } = require('../utils/verifySignature');
const { leaderboardLimiter, saveResultLimiter } = require('../middleware/rateLimiter');
const Player = require('../models/Player');
const AccountLink = require('../models/AccountLink');

/**
 * POST /api/account/auth/telegram
 * Авторизация через Telegram Mini App
 * Body: { telegramId, firstName, username }
 */
router.post('/auth/telegram', leaderboardLimiter, async (req, res) => {
  try {
    const { telegramId, firstName, username } = req.body;

    if (!telegramId) {
      return res.status(400).json({ error: 'Missing telegramId' });
    }

    const account = await getOrCreateTelegramAccount(telegramId);

    console.log(`📱 Telegram auth: ${telegramId} (${firstName || username || 'anon'}) → primaryId: ${account.primaryId}`);

    res.json({
      success: true,
      primaryId: account.primaryId,
      telegramId: account.telegramId,
      wallet: account.wallet,
      isLinked: account.isLinked,
      displayName: firstName || username || `TG#${telegramId}`
    });

  } catch (error) {
    console.error('❌ POST /auth/telegram error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/account/auth/wallet
 * Авторизация через кошелёк (браузер)
 * Body: { wallet, signature, timestamp }
 */
router.post('/auth/wallet', leaderboardLimiter, async (req, res) => {
  try {
    const { wallet, signature, timestamp } = req.body;

    if (!wallet || !signature || !timestamp) {
      return res.status(400).json({ error: 'Missing wallet, signature, or timestamp' });
    }

    const walletLower = wallet.toLowerCase();

    // Верификация подписи
    const message = `Auth wallet\nWallet: ${walletLower}\nTimestamp: ${timestamp}`;
    const isValid = verifySignature(message, signature, walletLower);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const account = await getOrCreateWalletAccount(walletLower);

    console.log(`🔗 Wallet auth: ${walletLower} → primaryId: ${account.primaryId}`);

    res.json({
      success: true,
      primaryId: account.primaryId,
      telegramId: account.telegramId,
      wallet: account.wallet,
      isLinked: account.isLinked
    });

  } catch (error) {
    console.error('❌ POST /auth/wallet error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/account/link/telegram
 * Привязать Telegram к существующему wallet аккаунту
 * Body: { primaryId, telegramId }
 */
router.post('/link/telegram', saveResultLimiter, async (req, res) => {
  try {
    const { primaryId, telegramId } = req.body;

    if (!primaryId || !telegramId) {
      return res.status(400).json({ error: 'Missing primaryId or telegramId' });
    }

    const result = await linkAccounts(primaryId, 'telegram', telegramId);
    res.json(result);

  } catch (error) {
    console.error('❌ POST /link/telegram error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/account/link/wallet
 * Привязать Wallet к существующему Telegram аккаунту
 * Body: { primaryId, wallet, signature, timestamp }
 */
router.post('/link/wallet', saveResultLimiter, async (req, res) => {
  try {
    const { primaryId, wallet, signature, timestamp } = req.body;

    if (!primaryId || !wallet || !signature || !timestamp) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const walletLower = wallet.toLowerCase();

    // Верификация подписи
    const message = `Link wallet\nWallet: ${walletLower}\nPrimaryId: ${primaryId}\nTimestamp: ${timestamp}`;
    const isValid = verifySignature(message, signature, walletLower);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const result = await linkAccounts(primaryId, 'wallet', walletLower);
    res.json(result);

  } catch (error) {
    console.error('❌ POST /link/wallet error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/account/info/:identifier
 * Получить информацию об аккаунте
 */
router.get('/info/:identifier', leaderboardLimiter, async (req, res) => {
  try {
    const identifier = req.params.identifier;

    const primaryId = await resolvePrimaryId(identifier);
    if (!primaryId) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const link = await AccountLink.findOne({ primaryId });
    const player = await Player.findOne({ wallet: primaryId });

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
    console.error('❌ GET /info error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
