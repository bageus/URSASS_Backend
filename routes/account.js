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
const { leaderboardLimiter, saveResultLimiter } = require('../middleware/rateLimiter');
const Player = require('../models/Player');
const AccountLink = require('../models/AccountLink');
const LinkCode = require('../models/LinkCode');

/**
 * Generate a random link code like "BEAR-A3F9K2"
 */
function generateLinkCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0,O,1,I to avoid confusion
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(crypto.randomInt(chars.length));
  }
  return `BEAR-${code}`;
}

/**
 * POST /api/account/auth/telegram
 * Auth via Telegram Mini App
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
 * Auth via wallet (browser)
 */
router.post('/auth/wallet', leaderboardLimiter, async (req, res) => {
  try {
    const { wallet, signature, timestamp } = req.body;

    if (!wallet || !signature || !timestamp) {
      return res.status(400).json({ error: 'Missing wallet, signature, or timestamp' });
    }

    const walletLower = wallet.toLowerCase();

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
 * POST /api/account/link/request-code
 * Request a verification code for linking Telegram to a wallet account.
 * Called from the frontend when user clicks "Link Telegram".
 * Body: { primaryId }
 */
router.post('/link/request-code', saveResultLimiter, async (req, res) => {
  try {
    const { primaryId } = req.body;

    if (!primaryId) {
      return res.status(400).json({ error: 'Missing primaryId' });
    }

    const primaryIdLower = primaryId.toLowerCase();

    // Verify account exists
    const link = await AccountLink.findOne({ primaryId: primaryIdLower });
    if (!link) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Check if already linked
    if (link.telegramId && link.wallet) {
      return res.status(400).json({ error: 'Account already fully linked' });
    }

    // Determine link type
    let linkType;
    if (link.wallet && !link.telegramId) {
      linkType = 'telegram'; // wallet user wants to link telegram
    } else if (link.telegramId && !link.wallet) {
      linkType = 'wallet'; // telegram user wants to link wallet
    } else {
      return res.status(400).json({ error: 'Cannot determine link type' });
    }

    // Invalidate old unused codes for this user
    await LinkCode.deleteMany({ primaryId: primaryIdLower, used: false });

    // Generate new code
    let code;
    let attempts = 0;
    do {
      code = generateLinkCode();
      attempts++;
      if (attempts > 10) {
        return res.status(500).json({ error: 'Failed to generate unique code' });
      }
    } while (await LinkCode.findOne({ code }));

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const linkCode = new LinkCode({
      primaryId: primaryIdLower,
      code,
      linkType,
      expiresAt
    });
    await linkCode.save();

    console.log(`🔑 Link code generated: ${code} for ${primaryIdLower} (${linkType})`);

    res.json({
      success: true,
      code,
      linkType,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: 600,
      botUsername: process.env.TELEGRAM_BOT_USERNAME || 'YourBotUsername',
      instruction: `Send this code to our Telegram bot: ${code}`
    });

  } catch (error) {
    console.error('❌ POST /link/request-code error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/account/link/verify-telegram
 * Called by the Telegram bot when user sends a verification code.
 * Body: { telegramId, code, botSecret }
 */
router.post('/link/verify-telegram', async (req, res) => {
  try {
    const { telegramId, code, botSecret } = req.body;

    if (!telegramId || !code) {
      return res.status(400).json({ error: 'Missing telegramId or code' });
    }

    // Verify bot secret (only our bot can call this endpoint)
    const expectedSecret = process.env.TELEGRAM_BOT_SECRET;
    if (expectedSecret && botSecret !== expectedSecret) {
      return res.status(401).json({ error: 'Invalid bot secret' });
    }

    const codeUpper = code.toUpperCase().trim();
    const tgIdStr = String(telegramId);

    // Find the code
    const linkCode = await LinkCode.findOne({ code: codeUpper, used: false });

    if (!linkCode) {
      return res.status(404).json({
        success: false,
        error: 'Code not found or already used'
      });
    }

    // Check expiration
    if (new Date() > linkCode.expiresAt) {
      await LinkCode.deleteOne({ _id: linkCode._id });
      return res.status(400).json({
        success: false,
        error: 'Code expired. Please request a new one.'
      });
    }

    // Mark code as used
    linkCode.used = true;
    await linkCode.save();

    // Perform the link
    const result = await linkAccounts(linkCode.primaryId, 'telegram', tgIdStr);

    if (result.success) {
      console.log(`✅ Telegram linked via bot: TG#${tgIdStr} → ${linkCode.primaryId}`);
    } else {
      console.log(`❌ Link failed: ${result.error}`);
    }

    res.json(result);

  } catch (error) {
    console.error('❌ POST /link/verify-telegram error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/account/link/wallet
 * Link Wallet to an existing Telegram account (from browser)
 */
router.post('/link/wallet', saveResultLimiter, async (req, res) => {
  try {
    const { primaryId, wallet, signature, timestamp } = req.body;

    if (!primaryId || !wallet || !signature || !timestamp) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const walletLower = wallet.toLowerCase();

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
 * Get account info
 */
router.get('/info/:identifier', leaderboardLimiter, async (req, res) => {
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
    console.error('❌ GET /info error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
