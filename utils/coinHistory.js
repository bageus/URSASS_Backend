const CoinTransaction = require('../models/CoinTransaction');
const AccountLink = require('../models/AccountLink');
const logger = require('./logger');


const PLAYER_MENU_INCOME_TYPES = [
  'share',
  'share_reward',
  'referral',
  'referral_bonus',
  'refer',
  'task',
  'onboarding_bonus',
  'onboarding',
  'race_reward',
  'game_reward'
];


function normalizeId(value) {
  return String(value || '').trim().toLowerCase();
}

function uniqueNormalizedIds(values = []) {
  return [...new Set(values.map(normalizeId).filter(Boolean))];
}

async function resolveCoinHistoryIds({ primaryId, authLink } = {}) {
  const fromAuth = uniqueNormalizedIds([
    primaryId,
    authLink?.primaryId,
    authLink?.wallet
  ]);

  if (!authLink?.wallet && fromAuth.length > 0) {
    const link = await AccountLink.findOne({ primaryId: fromAuth[0] });
    if (link?.wallet) {
      return uniqueNormalizedIds([...fromAuth, link.wallet]);
    }
  }

  return fromAuth;
}

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
    if (opts.contextKey) {
      const existing = await CoinTransaction.findOne({ contextKey: opts.contextKey });
      if (existing) return existing;
    }

    const entry = await CoinTransaction.create({
      primaryId: normalizedPrimaryId,
      type,
      contextKey: opts.contextKey || null,
      reason: opts.reason || null,
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

module.exports = {
  recordCoinReward,
  normalizeId,
  uniqueNormalizedIds,
  resolveCoinHistoryIds,
  PLAYER_MENU_INCOME_TYPES
};
