const OnboardingState = require('../models/OnboardingState');
const PlayerUpgrades = require('../models/PlayerUpgrades');
const AccountLink = require('../models/AccountLink');
const Player = require('../models/Player');
const GameResult = require('../models/GameResult');
const PlayerRun = require('../models/PlayerRun');
const CLAIMABLE_REWARDS = new Set(['radar_obstacles_24h', 'radar_gold_24h']);

const ONBOARDING_KEYS = [
  'first_race',
  'second_race_game_over',
  'second_race_menu',
  'third_race_game_over',
  'third_race_menu',
  'share_result_game_over',
  'share_result_player_menu',
  'store_start',
  'store_in',
  'gift_radar_obstacles_menu',
  'gift_radar_obstacles_store',
  'gift_radar_gold_menu',
  'gift_radar_gold_store'
];

function resolvePrimaryIdFromRequest(req) {
  return String(req.primaryId || req.get('x-primary-id') || req.get('x-wallet') || req.body?.primaryId || req.query?.primaryId || '')
    .trim()
    .toLowerCase();
}

async function shouldCountAuthenticatedRun(primaryId) {
  if (!primaryId) return false;
  const [link, player] = await Promise.all([
    AccountLink.findOne({ $or: [{ primaryId }, { wallet: primaryId }, { telegramId: primaryId }] }).select('_id').lean(),
    Player.findOne({ wallet: primaryId }).select('_id').lean()
  ]);
  return Boolean(link || player);
}

async function resolveIdentity(primaryId) {
  const normalizedId = String(primaryId || '').trim().toLowerCase();
  if (!normalizedId) return { primaryId: normalizedId, wallet: null, telegramId: null };

  const link = await AccountLink.findOne({
    $or: [{ primaryId: normalizedId }, { wallet: normalizedId }, { telegramId: normalizedId }]
  }).select('primaryId wallet telegramId').lean();

  const looksLikeWallet = normalizedId.startsWith('0x');
  return {
    primaryId: link?.primaryId || normalizedId,
    wallet: link?.wallet || (looksLikeWallet ? normalizedId : null),
    telegramId: link?.telegramId || (normalizedId.startsWith('tg_') ? normalizedId.slice(3) : null)
  };
}

function isTerminalOnboardingStatus(status) {
  return ['skip', 'complete', 'dismiss', 'dismissed'].includes(String(status || '').trim().toLowerCase());
}

function initOnboardingMap(state) {
  state.onboarding = state.onboarding || new Map();
  for (const key of ONBOARDING_KEYS) {
    if (!state.onboarding.get(key)) {
      state.onboarding.set(key, { status: 'none', shownContext: [], updatedAt: new Date() });
    }
  }
}

async function getOrCreateOnboardingState(primaryId) {
  let state = await OnboardingState.findOne({ primaryId });
  if (!state) state = await OnboardingState.create({ primaryId });
  initOnboardingMap(state);
  return state;
}

async function getGameplayHistorySnapshot(primaryId) {
  const identity = await resolveIdentity(primaryId);
  const resolvedPrimaryId = identity.primaryId || null;
  const wallet = identity.wallet || null;
  const telegramId = identity.telegramId ? String(identity.telegramId).trim().toLowerCase() : null;

  const walletCandidates = [
    wallet,
    resolvedPrimaryId,
    telegramId,
    telegramId ? `tg_${telegramId}` : null
  ].filter(Boolean);
  const uniqueWalletCandidates = [...new Set(walletCandidates)];

  const playerQuery = [
    wallet ? { wallet } : null,
    resolvedPrimaryId ? { wallet: resolvedPrimaryId } : null,
    telegramId ? { wallet: telegramId } : null,
    telegramId ? { wallet: `tg_${telegramId}` } : null
  ].filter(Boolean);

  const playerPromise = playerQuery.length
    ? Player.findOne({ $or: playerQuery }).sort({ xConnectedAt: -1, updatedAt: -1, createdAt: -1 }).select('gamesPlayed xConnectedAt').lean()
    : null;

  const leaderboardQuery = uniqueWalletCandidates.length
    ? { verified: true, isValid: true, wallet: { $in: uniqueWalletCandidates } }
    : null;

  const gameResultQuery = uniqueWalletCandidates.length
    ? { wallet: { $in: uniqueWalletCandidates } }
    : null;

  const [player, leaderboardCompletedCount, gameResultCountAll, gameResultCountVerified] = await Promise.all([
    playerPromise,
    leaderboardQuery ? PlayerRun.countDocuments(leaderboardQuery) : 0,
    gameResultQuery ? GameResult.countDocuments(gameResultQuery) : 0,
    gameResultQuery ? GameResult.countDocuments({ ...gameResultQuery, verified: true }) : 0
  ]);

  const playerGamesPlayed = Number(player?.gamesPlayed || 0);
  const raceCount = Math.max(leaderboardCompletedCount, playerGamesPlayed);

  return {
    raceCount,
    xConnected: Boolean(player?.xConnectedAt),
    identity,
    wallet,
    telegramId,
    playerGamesPlayed,
    leaderboardCompletedCount,
    gameResultCountAll,
    gameResultCountVerified
  };
}

function getStatus(state, key) {
  return state.onboarding.get(key)?.status || 'none';
}

function isOnboardingStepEligible(state, key) {
  return !isTerminalOnboardingStatus(getStatus(state, key));
}

function setOnboardingEvent(state, { key, action, screen }) {
  initOnboardingMap(state);
  const row = state.onboarding.get(key);
  if (!row) return false;
  if (action === 'shown') {
    if (screen && !row.shownContext.includes(screen)) row.shownContext.push(screen);
  } else if (action === 'skip' || action === 'complete') {
    row.status = action;
  }
  row.updatedAt = new Date();
  state.onboarding.set(key, row);
  return true;
}

function applyRunProgress(state, raceCount) {
  const rewards = { silverBonus: 0, goldBonus: 0, unlocked: [], granted: [] };
  state.authRunsCount = raceCount;
  if (raceCount >= 2 && !state.rewards.secondRaceSilver100Claimed) {
    state.rewards.secondRaceSilver100Claimed = true;
    state.rewards.silverAfterSecondRunGranted = true;
    rewards.silverBonus = 100;
    rewards.granted.push('silver_after_second_run');
  }
  if (raceCount >= 3 && !state.rewards.thirdRaceGold100Claimed) {
    state.rewards.thirdRaceGold100Claimed = true;
    state.rewards.goldAfterThirdRunGranted = true;
    rewards.goldBonus = 100;
    rewards.granted.push('gold_after_third_run');
  }
  if (raceCount >= 6 && !state.gifts.radarObstacles.unlocked) {
    state.gifts.radarObstacles.unlocked = true;
    rewards.unlocked.push('radar_obstacles_24h');
  }
  if (raceCount >= 15 && !state.gifts.radarGold.unlocked) {
    state.gifts.radarGold.unlocked = true;
    rewards.unlocked.push('radar_gold_24h');
  }
  return rewards;
}

function resolveActiveOnboarding({ state, raceCount, xConnected, screen }) {
  const isMenu = screen === 'menu';
  const isGameOver = screen === 'game-over';
  const isPlayerMenu = screen === 'player-menu';
  const isStore = screen === 'store';

  if (raceCount === 0 && isOnboardingStepEligible(state, 'first_race') && isMenu) return { key: 'first_race', screen: 'menu', target: 'start_game', hook: 'Start your first race' };
  if (raceCount === 1 && isGameOver && isOnboardingStepEligible(state, 'second_race_game_over')) return { key: 'second_race_game_over', screen: 'game-over', target: 'play_again', hook: 'Play again and get +100 silver' };
  if (raceCount === 1 && isMenu && isOnboardingStepEligible(state, 'second_race_menu')) return { key: 'second_race_menu', screen: 'menu', target: 'start_game', hook: 'Play again and get +100 silver' };
  if (raceCount === 2 && isGameOver && isOnboardingStepEligible(state, 'third_race_game_over')) return { key: 'third_race_game_over', screen: 'game-over', target: 'play_again', hook: 'Play again and get +100 gold' };
  if (raceCount === 2 && isMenu && isOnboardingStepEligible(state, 'third_race_menu')) return { key: 'third_race_menu', screen: 'menu', target: 'start_game', hook: 'Play again and get +100 gold' };
  if (raceCount >= 3 && !xConnected && isGameOver && isOnboardingStepEligible(state, 'share_result_game_over')) return { key: 'share_result_game_over', screen: 'game-over', target: 'connect_x_or_share_result', hook: 'Share your result and get a bonus' };
  if (raceCount >= 3 && !xConnected && isPlayerMenu && isOnboardingStepEligible(state, 'share_result_player_menu')) return { key: 'share_result_player_menu', screen: 'player-menu', target: 'player_menu_connect_x', hook: 'Connect X and get a bonus' };
  if (raceCount >= 3 && isMenu && isOnboardingStepEligible(state, 'store_start')) return { key: 'store_start', screen: 'menu', target: 'store_button', hook: 'Open Store to upgrade your runs' };
  if (raceCount >= 3 && isStore && isOnboardingStepEligible(state, 'store_in')) return { key: 'store_in', screen: 'store', target: 'ride_pack_plus3', hook: 'Upgrade with +3 rides pack' };
  if (raceCount >= 6 && !state.gifts.radarObstacles.claimed && isMenu && isOnboardingStepEligible(state, 'gift_radar_obstacles_menu')) return { key: 'gift_radar_obstacles_menu', screen: 'menu', target: 'gift_icon', hook: 'Free radar obstacles 24h gift' };
  if (raceCount >= 6 && !state.gifts.radarObstacles.claimed && isStore && isOnboardingStepEligible(state, 'gift_radar_obstacles_store')) return { key: 'gift_radar_obstacles_store', screen: 'store', target: 'radar_obstacles_24h_card', hook: 'Free 24h gift' };
  if (raceCount >= 15 && !state.gifts.radarGold.claimed && isMenu && isOnboardingStepEligible(state, 'gift_radar_gold_menu')) return { key: 'gift_radar_gold_menu', screen: 'menu', target: 'gift_icon', hook: 'Free radar gold 24h gift' };
  if (raceCount >= 15 && !state.gifts.radarGold.claimed && isStore && isOnboardingStepEligible(state, 'gift_radar_gold_store')) return { key: 'gift_radar_gold_store', screen: 'store', target: 'radar_gold_24h_card', hook: 'Free 24h gift' };

  return null;
}

async function claimReward({ state, primaryId, wallet, reward }) {
  if (!CLAIMABLE_REWARDS.has(reward)) throw Object.assign(new Error('unsupported_reward'), { statusCode: 400 });

  const normalizedWallet = String(wallet || primaryId || '').trim().toLowerCase();
  const upgrades = await PlayerUpgrades.findOneAndUpdate(
    { wallet: normalizedWallet },
    { $setOnInsert: { wallet: normalizedWallet } },
    { upsert: true, new: true }
  );

  const rewardConfig = reward === 'radar_obstacles_24h'
    ? {
      stateGiftPath: 'radarObstacles',
      boostPath: 'temporaryBoosts.radarObstaclesUntil',
      currentBoostUntil: upgrades.temporaryBoosts?.radarObstaclesUntil
    }
    : {
      stateGiftPath: 'radarGold',
      boostPath: 'temporaryBoosts.radarGoldUntil',
      currentBoostUntil: upgrades.temporaryBoosts?.radarGoldUntil
    };

  const giftState = state.gifts[rewardConfig.stateGiftPath];
  const existingUntil = rewardConfig.currentBoostUntil;
  const existingUntilMs = existingUntil ? new Date(existingUntil).getTime() : 0;

  if (giftState.claimed || (existingUntilMs && existingUntilMs > Date.now())) {
    giftState.claimed = true;
    if (!giftState.activeUntil && existingUntil) {
      giftState.activeUntil = existingUntil;
      await state.save();
    }
    return { alreadyClaimed: true, until: existingUntil || giftState.activeUntil || null };
  }

  const until = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const claimedPath = `gifts.${rewardConfig.stateGiftPath}.claimed`;
  const activeUntilPath = `gifts.${rewardConfig.stateGiftPath}.activeUntil`;

  const claimedState = await OnboardingState.findOneAndUpdate(
    { primaryId: state.primaryId, [claimedPath]: { $ne: true } },
    { $set: { [claimedPath]: true, [activeUntilPath]: until } },
    { new: true }
  );

  if (!claimedState) {
    const latestState = await OnboardingState.findOne({ primaryId: state.primaryId }).select(`gifts.${rewardConfig.stateGiftPath}`).lean();
    const latestUntil = upgrades.temporaryBoosts?.[rewardConfig.stateGiftPath === 'radarObstacles' ? 'radarObstaclesUntil' : 'radarGoldUntil']
      || latestState?.gifts?.[rewardConfig.stateGiftPath]?.activeUntil
      || null;
    return { alreadyClaimed: true, until: latestUntil };
  }

  const updatedUpgrades = await PlayerUpgrades.findOneAndUpdate(
    {
      wallet: normalizedWallet,
      $or: [
        { [rewardConfig.boostPath]: { $exists: false } },
        { [rewardConfig.boostPath]: null },
        { [rewardConfig.boostPath]: { $lte: new Date() } }
      ]
    },
    { $set: { [rewardConfig.boostPath]: until } },
    { new: true }
  );

  if (!updatedUpgrades) {
    const latestUpgrades = await PlayerUpgrades.findOne({ wallet: normalizedWallet }).select(rewardConfig.boostPath).lean();
    const latestUntil = rewardConfig.stateGiftPath === 'radarObstacles'
      ? latestUpgrades?.temporaryBoosts?.radarObstaclesUntil
      : latestUpgrades?.temporaryBoosts?.radarGoldUntil;
    return { alreadyClaimed: true, until: latestUntil || until };
  }

  state.gifts[rewardConfig.stateGiftPath].claimed = true;
  state.gifts[rewardConfig.stateGiftPath].activeUntil = until;
  return { alreadyClaimed: false, until };
}

module.exports = {
  ONBOARDING_KEYS,
  resolvePrimaryIdFromRequest,
  shouldCountAuthenticatedRun,
  resolveIdentity,
  isTerminalOnboardingStatus,
  getOrCreateOnboardingState,
  getGameplayHistorySnapshot,
  setOnboardingEvent,
  applyRunProgress,
  resolveActiveOnboarding,
  claimReward
};
