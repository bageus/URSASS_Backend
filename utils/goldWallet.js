const Player = require('../models/Player');
const logger = require('./logger');

/**
 * Atomically add gold to a player's gold balance.
 * @param {string} primaryId - The player's primaryId (wallet or tg_<id>)
 * @param {number} amount - Amount of gold to add
 * @param {string} reason - Reason for the gold award (for logging)
 * @returns {Promise<number>} New gold balance
 */
async function addGold(primaryId, amount, reason) {
  if (!primaryId || typeof amount !== 'number' || amount <= 0) {
    throw new Error(`addGold: invalid arguments primaryId=${primaryId} amount=${amount}`);
  }

  const result = await Player.findOneAndUpdate(
    { wallet: primaryId },
    { $inc: { gold: amount }, $set: { updatedAt: new Date() } },
    { new: true, upsert: false }
  );

  if (!result) {
    logger.warn({ primaryId, amount, reason }, 'addGold: player not found');
    throw new Error(`addGold: player not found for primaryId=${primaryId}`);
  }

  logger.info({ primaryId, amount, reason, newBalance: result.gold }, 'Gold awarded');

  return result.gold;
}

module.exports = { addGold };
