const express = require('express');
const { readLimiter } = require('../middleware/rateLimiter');
const PlayerUpgrades = require('../models/PlayerUpgrades');
const AccountLink = require('../models/AccountLink');
const logger = require('../utils/logger');
const {
  ONBOARDING_KEYS,
  resolvePrimaryIdFromRequest,
  resolveIdentity,
  getOrCreateOnboardingState,
  getGameplayHistorySnapshot,
  applyRunProgress,
  shouldCountAuthenticatedRun,
  setOnboardingEvent,
  resolveActiveOnboarding,
  claimReward
} = require('../services/onboardingService');
const { trackOnboardingEvent } = require('../services/onboardingAnalytics');

const router = express.Router();

function explainNoActiveOnboarding({ screen, raceCount, xConnected, onboarding }) {
  if (screen === 'menu') {
    if (raceCount === 1 && onboarding.second_race_menu !== 'none') return `second_race_menu_status_${onboarding.second_race_menu}`;
    if (raceCount === 2 && onboarding.third_race_menu !== 'none') return `third_race_menu_status_${onboarding.third_race_menu}`;
  }
  if (screen === 'player-menu') {
    if (raceCount >= 3 && xConnected) return 'x_connected';
    if (raceCount >= 3 && onboarding.share_result_player_menu !== 'none') return `share_result_player_menu_status_${onboarding.share_result_player_menu}`;
  }
  if (screen === 'game-over') {
    if (raceCount === 1 && onboarding.second_race_game_over !== 'none') return `second_race_game_over_status_${onboarding.second_race_game_over}`;
    if (raceCount === 2 && onboarding.third_race_game_over !== 'none') return `third_race_game_over_status_${onboarding.third_race_game_over}`;
    if (raceCount >= 3 && xConnected) return 'x_connected';
    if (raceCount >= 3 && onboarding.share_result_game_over !== 'none') return `share_result_game_over_status_${onboarding.share_result_game_over}`;
  }
  return 'no_matching_condition';
}

function buildStateResponse(state, upgrades, gameplayHistory, screen) {
  const onboarding = Object.fromEntries(ONBOARDING_KEYS.map((key) => [key, state.onboarding.get(key)?.status || 'none']));
  const activeOnboarding = resolveActiveOnboarding({
    state,
    raceCount: gameplayHistory.raceCount,
    xConnected: gameplayHistory.xConnected,
    screen
  });
  return {
    completed: ONBOARDING_KEYS.every((key) => onboarding[key] !== 'none'),
    raceCount: gameplayHistory.raceCount,
    xConnected: gameplayHistory.xConnected,
    activeOnboarding: activeOnboarding ? { ...activeOnboarding, status: onboarding[activeOnboarding.key] } : null,
    onboarding,
    rewards: {
      secondRaceSilver100Claimed: Boolean(state.rewards.secondRaceSilver100Claimed || state.rewards.silverAfterSecondRunGranted),
      thirdRaceGold100Claimed: Boolean(state.rewards.thirdRaceGold100Claimed || state.rewards.goldAfterThirdRunGranted)
    },
    gifts: {
      radar_obstacles_24h: { available: gameplayHistory.raceCount >= 6, claimed: state.gifts.radarObstacles.claimed },
      radar_gold_24h: { available: gameplayHistory.raceCount >= 15, claimed: state.gifts.radarGold.claimed }
    },
    activeBoosts: {
      radarObstaclesUntil: upgrades?.temporaryBoosts?.radarObstaclesUntil || null,
      radarGoldUntil: upgrades?.temporaryBoosts?.radarGoldUntil || null
    }
  };
}

router.get('/state', readLimiter, async (req, res) => {
  const primaryId = resolvePrimaryIdFromRequest(req);
  if (!primaryId) return res.status(400).json({ error: 'primaryId_required' });

  const identity = await resolveIdentity(primaryId);
  const account = await AccountLink.findOne({ $or: [{ primaryId }, { wallet: primaryId }, { telegramId: primaryId }] }).select('wallet telegramId').lean();
  const canUseAuthOnboarding = await shouldCountAuthenticatedRun(primaryId);
  const gameplayHistory = await getGameplayHistorySnapshot(primaryId);

  const state = await getOrCreateOnboardingState(primaryId);
  if (canUseAuthOnboarding) applyRunProgress(state, gameplayHistory.raceCount);
  await state.save();

  const upgrades = await PlayerUpgrades.findOne({ wallet: primaryId });
  const screen = String(req.query?.screen || 'menu').trim();
  const response = buildStateResponse(state, upgrades, gameplayHistory, screen);
  const reason = response.activeOnboarding ? null : explainNoActiveOnboarding({
    screen,
    raceCount: gameplayHistory.raceCount,
    xConnected: gameplayHistory.xConnected,
    onboarding: response.onboarding
  });
  logger.info({
    userId: primaryId,
    resolvedWallet: identity.wallet || account?.wallet || null,
    telegramId: identity.telegramId || account?.telegramId || null,
    screen,
    canUseAuthOnboarding,
    playerGamesPlayed: gameplayHistory.playerGamesPlayed,
    gameResultCountAll: gameplayHistory.gameResultCountAll,
    gameResultCountVerified: gameplayHistory.gameResultCountVerified,
    leaderboardCompletedCount: gameplayHistory.leaderboardCompletedCount,
    finalRaceCount: gameplayHistory.raceCount,
    raceCount: gameplayHistory.raceCount,
    xConnected: gameplayHistory.xConnected,
    onboardingStatuses: response.onboarding,
    activeOnboardingKey: response.activeOnboarding?.key || null,
    reason
  }, 'Onboarding state resolved');
  return res.json(response);
});

router.post('/event', async (req, res) => {
  const primaryId = resolvePrimaryIdFromRequest(req);
  if (!primaryId) return res.status(400).json({ error: 'primaryId_required' });
  const key = String(req.body?.key || '').trim();
  const action = String(req.body?.action || '').trim();
  const screen = String(req.body?.screen || '').trim();
  if (!ONBOARDING_KEYS.includes(key)) return res.status(400).json({ error: 'unsupported_key' });
  if (!['shown', 'skip', 'complete'].includes(action)) return res.status(400).json({ error: 'unsupported_action' });

  const state = await getOrCreateOnboardingState(primaryId);
  setOnboardingEvent(state, { key, action, screen });
  await state.save();
  await trackOnboardingEvent('onboarding_event', { primaryId, key, action, screen });
  const gameplayHistory = await getGameplayHistorySnapshot(primaryId);
  const upgrades = await PlayerUpgrades.findOne({ wallet: primaryId });
  return res.json({ success: true, state: buildStateResponse(state, upgrades, gameplayHistory, screen || 'menu') });
});

router.post('/claim', async (req, res) => {
  try {
    const primaryId = resolvePrimaryIdFromRequest(req);
    if (!primaryId) return res.status(400).json({ error: 'primaryId_required' });
    const reward = String(req.body?.reward || '').trim();
    const state = await getOrCreateOnboardingState(primaryId);
    const claim = await claimReward({ state, primaryId, reward });
    if (!claim.alreadyClaimed) {
      await trackOnboardingEvent('onboarding_reward_claimed', { primaryId, reward, flowVersion: state.flowVersion || 'v2' });
      await trackOnboardingEvent('radar_gift_claimed', { primaryId, reward, flowVersion: state.flowVersion || 'v2' });
    }
    return res.json({ success: true, reward, ...claim });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || 'claim_failed' });
  }
});

module.exports = router;
