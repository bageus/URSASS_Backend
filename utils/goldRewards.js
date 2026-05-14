const mongoose = require('mongoose');
const Player = require('../models/Player');
const CoinTransaction = require('../models/CoinTransaction');
const logger = require('./logger');

async function grantGoldReward(primaryId, amount, type, contextKey, opts = {}) {
  const normalizedPrimaryId = String(primaryId || '').trim().toLowerCase();
  const normalizedAmount = Math.floor(Number(amount));

  if (!normalizedPrimaryId || !type || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    logger.warn({ primaryId, amount, type, contextKey }, 'grantGoldReward: invalid arguments');
    return { balance: null, history: null, created: false };
  }

  const useContextKey = contextKey ? String(contextKey).trim() : null;

  if (useContextKey) {
    const existing = await CoinTransaction.findOne({ contextKey: useContextKey });
    if (existing) {
      const player = await Player.findOne({ wallet: normalizedPrimaryId });
      return { balance: player ? player.totalGoldCoins : null, history: existing, created: false };
    }
  }

  let session = null;
  const isTxnUnsupportedError = (error) => {
    const message = String(error?.message || '');
    return (
      error?.code === 20 ||
      error?.name === 'IllegalOperation' ||
      message.includes('Transaction numbers are only allowed on a replica set member or mongos')
    );
  };

  const executeRewardWork = async (session = null) => {
    const playerQuery = Player.findOneAndUpdate(
      { wallet: normalizedPrimaryId },
      { $inc: { totalGoldCoins: normalizedAmount } },
      { new: true }
    );
    if (session) playerQuery.session(session);
    const updatedPlayer = await playerQuery;
    if (!updatedPlayer) throw new Error('player_not_found');

    const historyDoc = {
      primaryId: normalizedPrimaryId,
      type,
      contextKey: useContextKey,
      gold: normalizedAmount,
      silver: 0,
      createdAt: opts.createdAt || new Date()
    };
    const created = await CoinTransaction.create([historyDoc], session ? { session } : undefined);
    const createdHistory = Array.isArray(created) ? created[0] : created;
    return { updatedPlayer, createdHistory };
  };

  try {
    if (typeof mongoose.startSession === 'function') {
      session = await mongoose.startSession();
    }

    let rewardResult = null;

    if (session) {
      try {
        await session.withTransaction(async () => {
          rewardResult = await executeRewardWork(session);
        });
      } catch (error) {
        if (isTxnUnsupportedError(error)) {
          logger.warn(
            { primaryId: normalizedPrimaryId, contextKey: useContextKey, requestId: opts.requestId, errorMessage: error?.message, errorCode: error?.code },
            'grantGoldReward transaction unsupported; using non-transactional fallback'
          );
          rewardResult = await executeRewardWork();
        } else {
          throw error;
        }
      }
    } else {
      rewardResult = await executeRewardWork();
    }

    return { balance: rewardResult.updatedPlayer.totalGoldCoins, history: rewardResult.createdHistory, created: true };
  } catch (error) {
    if (useContextKey && error && error.code === 11000) {
      const existing = await CoinTransaction.findOne({ contextKey: useContextKey });
      const player = await Player.findOne({ wallet: normalizedPrimaryId });
      return { balance: player ? player.totalGoldCoins : null, history: existing, created: false };
    }

    logger.error({ err: error, primaryId: normalizedPrimaryId, amount: normalizedAmount, type, contextKey: useContextKey, requestId: opts.requestId }, 'grantGoldReward failed');
    return { balance: null, history: null, created: false, error };
  } finally {
    if (session) await session.endSession();
  }
}

module.exports = { grantGoldReward };
