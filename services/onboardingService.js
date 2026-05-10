const OnboardingState = require('../models/OnboardingState');
const PlayerUpgrades = require('../models/PlayerUpgrades');
const AccountLink = require('../models/AccountLink');

const CLAIMABLE_REWARDS = new Set(['radar_obstacles_24h', 'radar_gold_24h']);

function resolvePrimaryIdFromRequest(req) {
  return String(req.primaryId || req.get('x-primary-id') || req.get('x-wallet') || req.body?.primaryId || req.query?.primaryId || '')
    .trim()
    .toLowerCase();
}


async function shouldCountAuthenticatedRun(primaryId) {
  if (!primaryId) return false;
  const link = await AccountLink.findOne({
    $or: [
      { primaryId },
      { wallet: primaryId }
    ]
  }).select('_id');
  return Boolean(link);
}

async function getOrCreateOnboardingState(primaryId) {
  let state = await OnboardingState.findOne({ primaryId });
  if (!state) state = await OnboardingState.create({ primaryId });
  return state;
}

function updateStep(state) {
  if (state.mainFlowCompleted) {
    state.currentStep = 'completed';
  } else if (state.authRunsCount >= 3 && !state.storeIntro.ridePackBought) {
    state.currentStep = 'store_intro';
  } else if (state.authRunsCount >= 2) {
    state.currentStep = 'auth_run_2_done';
  } else if (state.authRunsCount >= 1) {
    state.currentStep = 'auth_run_1_done';
  } else {
    state.currentStep = 'auth_start';
  }
}

function applyRunProgress(state) {
  state.authRunsCount += 1;
  const rewards = { silverBonus: 0, goldBonus: 0, unlocked: [], granted: [] };

  if (state.authRunsCount >= 2 && !state.rewards.silverAfterSecondRunGranted) {
    state.rewards.silverAfterSecondRunGranted = true;
    rewards.silverBonus = 100;
    rewards.granted.push('silver_after_second_run');
  }
  if (state.authRunsCount >= 3 && !state.rewards.goldAfterThirdRunGranted) {
    state.rewards.goldAfterThirdRunGranted = true;
    rewards.goldBonus = 100;
    rewards.granted.push('gold_after_third_run');
  }
  if (state.authRunsCount >= 6 && !state.gifts.radarObstacles.unlocked) {
    state.gifts.radarObstacles.unlocked = true;
    rewards.unlocked.push('radar_obstacles_24h');
  }
  if (state.authRunsCount >= 15 && !state.gifts.radarGold.unlocked) {
    state.gifts.radarGold.unlocked = true;
    rewards.unlocked.push('radar_gold_24h');
  }
  updateStep(state);
  return rewards;
}

async function claimReward({ state, primaryId, reward }) {
  if (!CLAIMABLE_REWARDS.has(reward)) {
    const err = new Error('unsupported_reward');
    err.statusCode = 400;
    throw err;
  }

  const upgrades = await PlayerUpgrades.findOneAndUpdate(
    { wallet: primaryId },
    { $setOnInsert: { wallet: primaryId } },
    { upsert: true, new: true }
  );

  const now = new Date();
  const until = new Date(now.getTime() + (24 * 60 * 60 * 1000));

  if (reward === 'radar_obstacles_24h') {
    if (!state.gifts.radarObstacles.unlocked) throw Object.assign(new Error('reward_locked'), { statusCode: 409 });
    if (state.gifts.radarObstacles.claimed) return { alreadyClaimed: true, until: upgrades.temporaryBoosts?.radarObstaclesUntil || null };
    state.gifts.radarObstacles.claimed = true;
    state.gifts.radarObstacles.activeUntil = until;
    upgrades.temporaryBoosts = upgrades.temporaryBoosts || {};
    upgrades.temporaryBoosts.radarObstaclesUntil = until;
  }

  if (reward === 'radar_gold_24h') {
    if (!state.gifts.radarGold.unlocked) throw Object.assign(new Error('reward_locked'), { statusCode: 409 });
    if (state.gifts.radarGold.claimed) return { alreadyClaimed: true, until: upgrades.temporaryBoosts?.radarGoldUntil || null };
    state.gifts.radarGold.claimed = true;
    state.gifts.radarGold.activeUntil = until;
    upgrades.temporaryBoosts = upgrades.temporaryBoosts || {};
    upgrades.temporaryBoosts.radarGoldUntil = until;
  }

  await upgrades.save();
  await state.save();
  return { alreadyClaimed: false, until };
}

module.exports = { resolvePrimaryIdFromRequest, shouldCountAuthenticatedRun, getOrCreateOnboardingState, applyRunProgress, updateStep, claimReward };
