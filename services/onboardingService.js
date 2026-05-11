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
  'share_result_menu',
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
  }).select('wallet telegramId').lean();

  const looksLikeWallet = normalizedId.startsWith('0x');
  return {
    primaryId: normalizedId,
    wallet: link?.wallet || (looksLikeWallet ? normalizedId : null),
    telegramId: link?.telegramId || (normalizedId.startsWith('tg_') ? normalizedId.slice(3) : null)
  };
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
  const wallet = identity.wallet;
  const [player, leaderboardCompletedCount, gameResultCountAll, gameResultCountVerified] = await Promise.all([
    wallet ? Player.findOne({ wallet }).select('gamesPlayed xConnected').lean() : null,
    wallet ? PlayerRun.countDocuments({ wallet, verified: true, isValid: true }) : 0,
    wallet ? GameResult.countDocuments({ wallet }) : 0,
    wallet ? GameResult.countDocuments({ wallet, verified: true }) : 0
  ]);

  const playerGamesPlayed = Number(player?.gamesPlayed || 0);
  const raceCount = Math.max(leaderboardCompletedCount, playerGamesPlayed);

  return {
    raceCount,
    xConnected: Boolean(player?.xConnected),
    identity,
    playerGamesPlayed,
    leaderboardCompletedCount,
    gameResultCountAll,
    gameResultCountVerified
  };
}

function getStatus(state, key) {
  return state.onboarding.get(key)?.status || 'none';
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
  const isStore = screen === 'store';

  if (raceCount === 0 && getStatus(state, 'first_race') === 'none' && isMenu) return { key: 'first_race', screen: 'menu', target: 'start_game', hook: 'Start your first race' };
  if (raceCount === 1 && isGameOver && getStatus(state, 'second_race_game_over') === 'none') return { key: 'second_race_game_over', screen: 'game-over', target: 'play_again', hook: 'Play again and get +100 silver' };
  if (raceCount === 1 && isMenu && getStatus(state, 'second_race_menu') === 'none') return { key: 'second_race_menu', screen: 'menu', target: 'start_game', hook: 'Play again and get +100 silver' };
  if (raceCount === 2 && isGameOver && getStatus(state, 'third_race_game_over') === 'none') return { key: 'third_race_game_over', screen: 'game-over', target: 'play_again', hook: 'Play again and get +100 gold' };
  if (raceCount === 2 && isMenu && getStatus(state, 'third_race_menu') === 'none') return { key: 'third_race_menu', screen: 'menu', target: 'start_game', hook: 'Play again and get +100 gold' };
  if (raceCount >= 3 && !xConnected && isGameOver && getStatus(state, 'share_result_game_over') === 'none') return { key: 'share_result_game_over', screen: 'game-over', target: 'connect_x_or_share_result', hook: 'Share your result and get a bonus' };
  if (raceCount >= 3 && !xConnected && isMenu && getStatus(state, 'share_result_menu') === 'none') return { key: 'share_result_menu', screen: 'menu', target: 'connect_x_or_share_result', hook: 'Connect X and get a bonus' };
  if (raceCount >= 3 && isMenu && getStatus(state, 'store_start') === 'none') return { key: 'store_start', screen: 'menu', target: 'store_button', hook: 'Open Store to upgrade your runs' };
  if (raceCount >= 3 && isStore && getStatus(state, 'store_in') === 'none') return { key: 'store_in', screen: 'store', target: 'ride_pack_plus3', hook: 'Upgrade with +3 rides pack' };
  if (raceCount >= 6 && !state.gifts.radarObstacles.claimed && isMenu && getStatus(state, 'gift_radar_obstacles_menu') === 'none') return { key: 'gift_radar_obstacles_menu', screen: 'menu', target: 'gift_icon', hook: 'Free radar obstacles 24h gift' };
  if (raceCount >= 6 && !state.gifts.radarObstacles.claimed && isStore && getStatus(state, 'gift_radar_obstacles_store') === 'none') return { key: 'gift_radar_obstacles_store', screen: 'store', target: 'radar_obstacles_24h_card', hook: 'Free 24h gift' };
  if (raceCount >= 15 && !state.gifts.radarGold.claimed && isMenu && getStatus(state, 'gift_radar_gold_menu') === 'none') return { key: 'gift_radar_gold_menu', screen: 'menu', target: 'gift_icon', hook: 'Free radar gold 24h gift' };
  if (raceCount >= 15 && !state.gifts.radarGold.claimed && isStore && getStatus(state, 'gift_radar_gold_store') === 'none') return { key: 'gift_radar_gold_store', screen: 'store', target: 'radar_gold_24h_card', hook: 'Free 24h gift' };

  return null;
}

async function claimReward({ state, primaryId, reward }) {
  if (!CLAIMABLE_REWARDS.has(reward)) throw Object.assign(new Error('unsupported_reward'), { statusCode: 400 });
  const upgrades = await PlayerUpgrades.findOneAndUpdate({ wallet: primaryId }, { $setOnInsert: { wallet: primaryId } }, { upsert: true, new: true });
  const until = new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (reward === 'radar_obstacles_24h') {
    if (state.gifts.radarObstacles.claimed) return { alreadyClaimed: true, until: upgrades.temporaryBoosts?.radarObstaclesUntil || null };
    state.gifts.radarObstacles.claimed = true;
    state.gifts.radarObstacles.activeUntil = until;
    upgrades.temporaryBoosts = upgrades.temporaryBoosts || {};
    upgrades.temporaryBoosts.radarObstaclesUntil = until;
  }
  if (reward === 'radar_gold_24h') {
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

module.exports = {
  ONBOARDING_KEYS,
  resolvePrimaryIdFromRequest,
  shouldCountAuthenticatedRun,
  resolveIdentity,
  getOrCreateOnboardingState,
  getGameplayHistorySnapshot,
  setOnboardingEvent,
  applyRunProgress,
  resolveActiveOnboarding,
  claimReward
};
