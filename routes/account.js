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
const { readLimiter, writeLimiter, authLimiter } = require('../middleware/rateLimiter');
const Player = require('../models/Player');
const AccountLink = require('../models/AccountLink');
const LinkCode = require('../models/LinkCode');
const SecurityEvent = require('../models/SecurityEvent');
const logger = require('../utils/logger');

async function logSecurityEvent({ wallet = null, eventType, route, ipAddress, details = {} }) {
  try {
    await SecurityEvent.create({ wallet, eventType, route, ipAddress, details });
  } catch (error) {
    logger.warn({ eventType, err: error.message }, 'Failed to persist SecurityEvent');
  }
}

function generateLinkCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(crypto.randomInt(chars.length));
  }
  return code;
}

router.post('/auth/telegram', authLimiter, async (req, res) => {
  try {
    const { telegramId, firstName, username } = req.body;

    if (!telegramId) {
      return res.status(400).json({ error: 'Missing telegramId' });
    }

    const account = await getOrCreateTelegramAccount(telegramId);

    logger.info({ telegramId: String(telegramId), primaryId: account.primaryId }, 'Telegram auth success');

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

router.post('/auth/wallet', authLimiter, async (req, res) => {
  try {
    const { wallet, signature, timestamp } = req.body;

    if (!wallet || !signature || !timestamp) {
      return res.status(400).json({ error: 'Missing wallet, signature, or timestamp' });
    }

    const walletLower = wallet.toLowerCase();
    const message = `Auth wallet\nWallet: ${walletLower}\nTimestamp: ${timestamp}`;
    const isValid = verifySignature(message, signature, walletLower);
    
    if (!isValid) {
      await logSecurityEvent({
        wallet: walletLower,
        eventType: 'wallet_auth_signature_failed',
        route: req.path,
        ipAddress: req.ip
      });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const account = await getOrCreateWalletAccount(walletLower);

    const link = await AccountLink.findOne({ primaryId: account.primaryId });

    logger.info({ wallet: walletLower, primaryId: account.primaryId }, 'Wallet auth success');

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

    await LinkCode.deleteMany({ primaryId: primaryIdLower, used: false });

    let code;
    let attempts = 0;
    do {
      code = generateLinkCode();
      attempts += 1;
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

router.post('/link/verify-telegram', authLimiter, async (req, res) => {
  try {
    const { telegramId, code, botSecret } = req.body;

    if (!telegramId || !code) {
      return res.status(400).json({ error: 'Missing telegramId or code' });
    }

    const expectedSecret = process.env.TELEGRAM_BOT_SECRET;
    if (expectedSecret && botSecret !== expectedSecret) {
        await logSecurityEvent({
        wallet: null,
        eventType: 'telegram_verify_invalid_secret',
        route: req.path,
        ipAddress: req.ip,
        details: { telegramId: String(telegramId) }
      });
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

router.post('/link/wallet', writeLimiter, async (req, res) => {
  try {
    const { primaryId, wallet, signature, timestamp } = req.body;

    if (!primaryId || !wallet || !signature || !timestamp) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const walletLower = wallet.toLowerCase();
    const message = `Link wallet\nWallet: ${walletLower}\nPrimaryId: ${primaryId}\nTimestamp: ${timestamp}`;
    const isValid = verifySignature(message, signature, walletLower);
    
    if (!isValid) {
      await logSecurityEvent({
        wallet: walletLower,
        eventType: 'link_wallet_signature_failed',
        route: req.path,
        ipAddress: req.ip,
        details: { primaryId }
      });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const result = await linkAccounts(primaryId, 'wallet', walletLower);
    res.json(result);
  } catch (error) {
    logger.error({ err: error }, 'POST /link/wallet error');
    res.status(500).json({ error: 'Server error' });
  }
});

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

module.exports = router;
