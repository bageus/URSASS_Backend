/**
 * middleware/requireAuth.js
 *
 * Auth middleware for API routes.
 * Resolves primaryId from request using:
 *   1. X-Primary-Id header → findOne({ primaryId }) with fallback to findOne({ wallet })
 *   2. X-Wallet header → findOne({ wallet }) with fallback to findOne({ primaryId })
 *   3. X-Telegram-Init-Data header → validate and look up AccountLink by telegramId
 *
 * Sets req.primaryId and req.authLink on success.
 * Returns 401 on failure.
 */

const AccountLink = require('../models/AccountLink');
const { validateTelegramInitData } = require('../utils/telegramAuth');
const logger = require('../utils/logger');

/**
 * Look up an AccountLink using all available identifiers, with cross-field fallbacks
 * for robustness when the frontend sends a telegram primaryId in X-Wallet or vice-versa.
 *
 * @param {string} rawPrimaryId - Value from X-Primary-Id header (trimmed, lowercased)
 * @param {string} rawWallet    - Value from X-Wallet header (trimmed, lowercased)
 * @param {string} initData     - Raw X-Telegram-Init-Data header value
 * @returns {object|null} AccountLink document, { __invalid: 'initdata' } on bad initData, or null
 */
async function findLink(rawPrimaryId, rawWallet, initData) {
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

  if (initData) {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      logger.warn({}, 'requireAuth: TELEGRAM_BOT_TOKEN is not configured; cannot validate Telegram initData');
      return { __invalid: 'initdata' };
    }
    const validation = validateTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
    if (!validation.valid) return { __invalid: 'initdata' };
    const tgId = String(validation.user.id);
    return await AccountLink.findOne({ telegramId: tgId });
  }

  return null;
}

/**
 * Express middleware. Calls findLink() and either sets req.primaryId + req.authLink,
 * or returns 401 JSON.
 */
async function requireAuth(req, res, next) {
  try {
    const rawPrimaryId = (req.get('x-primary-id') || '').trim().toLowerCase();
    const rawWallet = (req.get('x-wallet') || '').trim().toLowerCase();
    const initData = req.get('x-telegram-init-data') || req.get('X-Telegram-Init-Data') || '';

    const link = await findLink(rawPrimaryId, rawWallet, initData);

    if (!link) {
      logger.warn({ rawWallet, rawPrimaryId, hasInitData: !!initData }, 'requireAuth: no AccountLink found');
      return res.status(401).json({ error: 'Unauthorized: no valid auth credentials' });
    }

    if (link.__invalid === 'initdata') {
      return res.status(401).json({ error: 'Invalid Telegram auth' });
    }

    req.primaryId = link.primaryId;
    req.authLink = link;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, findLink };
