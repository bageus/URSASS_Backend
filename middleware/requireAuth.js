const AccountLink = require('../models/AccountLink');
const { validateTelegramInitData } = require('../utils/telegramAuth');
const { verifySessionToken } = require('../utils/sessionToken');
const logger = require('../utils/logger');

function isLegacyAuthAllowed() {
  return String(process.env.ALLOW_LEGACY_HEADER_AUTH || 'false').trim().toLowerCase() === 'true';
}

async function findLegacyLink(rawPrimaryId, rawWallet, rawBearerId) {
  if (rawPrimaryId) {
    const byPrimary = await AccountLink.findOne({ primaryId: rawPrimaryId });
    if (byPrimary) return byPrimary;
    const byWallet = await AccountLink.findOne({ wallet: rawPrimaryId });
    if (byWallet) return byWallet;
  }

  if (rawWallet) {
    const byWallet = await AccountLink.findOne({ wallet: rawWallet });
    if (byWallet) return byWallet;
    const byPrimary = await AccountLink.findOne({ primaryId: rawWallet });
    if (byPrimary) return byPrimary;
  }

  if (rawBearerId) {
    const byPrimary = await AccountLink.findOne({ primaryId: rawBearerId });
    if (byPrimary) return byPrimary;
    const byWallet = await AccountLink.findOne({ wallet: rawBearerId });
    if (byWallet) return byWallet;
  }

  return null;
}

async function requireAuth(req, res, next) {
  try {
    const authorization = req.get('authorization') || '';
    const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
    const token = bearerMatch ? bearerMatch[1].trim() : '';

    if (token) {
      try {
        const decoded = verifySessionToken(token);
        const primaryId = String(decoded?.primaryId || '').trim().toLowerCase();
        if (!primaryId) {
          return res.status(401).json({ error: 'Unauthorized: invalid token payload' });
        }
        const link = await AccountLink.findOne({ primaryId });
        if (!link) {
          return res.status(401).json({ error: 'Unauthorized: account not found' });
        }
        req.primaryId = link.primaryId;
        req.authLink = link;
        req.auth = decoded;
        return next();
      } catch (err) {
        return res.status(401).json({ error: 'Unauthorized: invalid or expired session token' });
      }
    }

    const initData = req.get('x-telegram-init-data') || req.get('X-Telegram-Init-Data') || '';
    if (initData) {
      if (!process.env.TELEGRAM_BOT_TOKEN) {
        return res.status(401).json({ error: 'Invalid Telegram auth' });
      }
      const validation = validateTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
      if (!validation.valid) {
        return res.status(401).json({ error: 'Invalid Telegram auth' });
      }
      const tgId = String(validation.user.id);
      const link = await AccountLink.findOne({ telegramId: tgId });
      if (!link) return res.status(401).json({ error: 'Unauthorized: account not found' });
      req.primaryId = link.primaryId;
      req.authLink = link;
      req.auth = { primaryId: link.primaryId, telegramId: tgId, authMode: 'telegram' };
      return next();
    }

    if (!isLegacyAuthAllowed()) {
      return res.status(401).json({ error: 'Unauthorized: session token required' });
    }

    const rawPrimaryId = (req.get('x-primary-id') || '').trim().toLowerCase();
    const rawWallet = (req.get('x-wallet') || '').trim().toLowerCase();
    const rawBearerId = bearerMatch ? bearerMatch[1].trim().toLowerCase() : '';
    const link = await findLegacyLink(rawPrimaryId, rawWallet, rawBearerId);
    if (!link) {
      logger.warn({ rawWallet, rawPrimaryId, rawBearerId }, 'requireAuth legacy: no AccountLink found');
      return res.status(401).json({ error: 'Unauthorized: no valid auth credentials' });
    }

    req.primaryId = link.primaryId;
    req.authLink = link;
    req.auth = { primaryId: link.primaryId, authMode: 'legacy' };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireAuth, findLegacyLink };
