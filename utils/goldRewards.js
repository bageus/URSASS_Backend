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
      return { balance: player ? player.gold : null, history: existing, created: false };
    }
  }

  let session = null;
  try {
    if (typeof mongoose.startSession === 'function') {
      session = await mongoose.startSession();
    }

    let createdHistory = null;
    let updatedPlayer = null;

    const work = async () => {
      const playerQuery = Player.findOneAndUpdate(
        { wallet: normalizedPrimaryId },
        { $inc: { gold: normalizedAmount } },
        { new: true }
      );
      if (session) playerQuery.session(session);
      updatedPlayer = await playerQuery;
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
      createdHistory = Array.isArray(created) ? created[0] : created;
    };

    if (session) {
      await session.withTransaction(work);
    } else {
      await work();
    }

    return { balance: updatedPlayer.gold, history: createdHistory, created: true };
  } catch (error) {
    if (useContextKey && error && error.code === 11000) {
      const existing = await CoinTransaction.findOne({ contextKey: useContextKey });
      const player = await Player.findOne({ wallet: normalizedPrimaryId });
      return { balance: player ? player.gold : null, history: existing, created: false };
    }

    logger.error({ err: error, primaryId: normalizedPrimaryId, amount: normalizedAmount, type, contextKey: useContextKey, requestId: opts.requestId }, 'grantGoldReward failed');
    return { balance: null, history: null, created: false, error };
  } finally {
    if (session) await session.endSession();
  }
}

module.exports = { grantGoldReward };
