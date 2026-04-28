const CoinTransaction = require('../models/CoinTransaction');
const logger = require('./logger');

async function recordCoinReward(primaryId, type, amounts = {}, opts = {}) {
  const normalizedPrimaryId = String(primaryId || '').trim().toLowerCase();
  const gold = Math.floor(Number(amounts.gold || 0));
  const silver = Math.floor(Number(amounts.silver || 0));

  if (!normalizedPrimaryId || !type) {
    logger.warn({ primaryId, type, amounts }, 'recordCoinReward: invalid arguments');
    return null;
  }

  if (!Number.isFinite(gold) || !Number.isFinite(silver) || gold < 0 || silver < 0) {
    logger.warn({ primaryId: normalizedPrimaryId, type, gold, silver }, 'recordCoinReward: invalid coin values');
    return null;
  }

  if (gold <= 0 && silver <= 0) {
    return null;
  }

  try {
    const entry = await CoinTransaction.create({
      primaryId: normalizedPrimaryId,
      type,
      gold,
      silver,
      createdAt: opts.createdAt || new Date()
    });

    return entry;
  } catch (error) {
    logger.error({ err: error, primaryId: normalizedPrimaryId, type, gold, silver, requestId: opts.requestId }, 'recordCoinReward failed');
    return null;
  }
}

module.exports = { recordCoinReward };
