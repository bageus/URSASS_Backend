const Player = require('../models/Player');
const logger = require('./logger');

/**
 * Atomically add gold to a player's reward wallet.
 *
 * @param {string} primaryId - Player's primaryId (wallet address or tg_xxx)
 * @param {number} amount    - Amount of gold to add (positive integer)
 * @param {string} reason    - Reason label for logging (e.g. 'share_daily', 'referral_referrer')
 * @param {object} [opts]
 * @param {string} [opts.requestId] - Request ID for log correlation
 * @returns {Promise<number|null>} New gold balance, or null if player not found
 */
async function addGold(primaryId, amount, reason, opts = {}) {
  if (!primaryId || typeof amount !== 'number' || amount <= 0) {
    logger.warn({ primaryId, amount, reason }, 'addGold: invalid arguments');
    return null;
  }

  const result = await Player.findOneAndUpdate(
    { wallet: primaryId },
    { $inc: { gold: amount } },
    { new: true }
  );

  if (!result) {
    logger.warn({ primaryId, amount, reason }, 'addGold: player not found');
    return null;
  }

  logger.info(
    { primaryId, amount, reason, newBalance: result.gold, requestId: opts.requestId },
    'Gold awarded'
  );

  return result.gold;
}

module.exports = { addGold };
