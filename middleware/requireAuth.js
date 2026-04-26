const AccountLink = require('../models/AccountLink');
const { validateTelegramInitData } = require('../utils/telegramAuth');

/**
 * Auth middleware for referral and share routes.
 * Resolves primaryId from request using:
 *   1. X-Primary-Id header (direct, validated against DB)
 *   2. X-Wallet header → look up AccountLink
 *   3. X-Telegram-Init-Data header → validate and look up AccountLink
 *
 * Sets req.primaryId and req.authLink on success.
 * Returns 401 on failure.
 */
async function requireAuth(req, res, next) {
  try {
    const rawPrimaryId = (req.get('x-primary-id') || '').trim().toLowerCase();
    const rawWallet = (req.get('x-wallet') || '').trim().toLowerCase();
    const initData = req.get('x-telegram-init-data') || req.get('X-Telegram-Init-Data') || '';

    let link = null;

    if (rawPrimaryId) {
      link = await AccountLink.findOne({ primaryId: rawPrimaryId });
    } else if (rawWallet) {
      link = await AccountLink.findOne({ wallet: rawWallet });
    } else if (initData) {
      const validation = validateTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
      if (!validation.valid) {
        return res.status(401).json({ error: 'Invalid Telegram auth' });
      }
      const tgId = String(validation.user.id);
      link = await AccountLink.findOne({ telegramId: tgId });
    }

    if (!link) {
      return res.status(401).json({ error: 'Unauthorized: no valid auth credentials' });
    }

    req.primaryId = link.primaryId;
    req.authLink = link;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
