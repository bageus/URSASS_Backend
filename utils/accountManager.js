const AccountLink = require('../models/AccountLink');
const Player = require('../models/Player');
const PlayerUpgrades = require('../models/PlayerUpgrades');
const logger = require('./logger');

const UPGRADE_LEVEL_FIELDS = [
  'x2_duration',
  'score_plus_300_mult',
  'score_plus_500_mult',
  'score_minus_300_mult',
  'score_minus_500_mult',
  'invert_score',
  'speed_up_mult',
  'speed_down_mult',
  'magnet_duration',
  'spin_cooldown',
  'shield',
  'shield_capacity',
  'radar',
  'alert'
];

function buildNewPlayer(primaryId) {
  return new Player({
    wallet: primaryId,
    bestScore: 0,
    bestDistance: 0,
    totalGoldCoins: 0,
    totalSilverCoins: 0,
    gamesPlayed: 0,
    gameHistory: []
  });
}

function buildAccountLink({ primaryId, telegramId = null, wallet = null }) {
  return new AccountLink({
    telegramId,
    wallet,
    primaryId,
    masterSource: null,
    linkedAt: null
  });
}

function buildAccountSummary({ primaryId, telegramId = null, wallet = null, isLinked = false }) {
  return {
    primaryId,
    telegramId,
    wallet,
    isLinked
  };
}

async function ensurePlayerExists(primaryId) {
  let player = await Player.findOne({ wallet: primaryId });
  if (!player) {
    player = buildNewPlayer(primaryId);
    await player.save();
  }
  return player;
}

async function ensureUpgradesExist(primaryId) {
  let upgrades = await PlayerUpgrades.findOne({ wallet: primaryId });
  if (!upgrades) {
    upgrades = new PlayerUpgrades({ wallet: primaryId });
    await upgrades.save();
  }
  return upgrades;
}

async function ensureAccountResources(primaryId) {
  await ensurePlayerExists(primaryId);
  await ensureUpgradesExist(primaryId);
}

function resetPlayerState(player) {
  player.bestScore = 0;
  player.bestDistance = 0;
  player.totalGoldCoins = 0;
  player.totalSilverCoins = 0;
  player.gamesPlayed = 0;
  player.gameHistory = [];
}

function resetUpgradesState(upgrades) {
  for (const field of UPGRADE_LEVEL_FIELDS) {
    upgrades[field] = 0;
  }

  upgrades.freeRidesRemaining = 0;
  upgrades.paidRidesRemaining = 0;
  upgrades.recentRideSessionIds = [];
  upgrades.freeRidesResetAt = new Date();
}

function mergePlayerState(masterPlayer, slavePlayer) {
  masterPlayer.bestScore = Math.max(masterPlayer.bestScore || 0, slavePlayer.bestScore || 0);
  masterPlayer.bestDistance = Math.max(masterPlayer.bestDistance || 0, slavePlayer.bestDistance || 0);
  masterPlayer.totalGoldCoins = (masterPlayer.totalGoldCoins || 0) + (slavePlayer.totalGoldCoins || 0);
  masterPlayer.totalSilverCoins = (masterPlayer.totalSilverCoins || 0) + (slavePlayer.totalSilverCoins || 0);
  masterPlayer.gamesPlayed = (masterPlayer.gamesPlayed || 0) + (slavePlayer.gamesPlayed || 0);

  const masterHistory = Array.isArray(masterPlayer.gameHistory) ? masterPlayer.gameHistory : [];
  const slaveHistory = Array.isArray(slavePlayer.gameHistory) ? slavePlayer.gameHistory : [];
  masterPlayer.gameHistory = [...masterHistory, ...slaveHistory]
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
    .slice(0, 100);

  if (masterPlayer.gamesPlayed > 0) {
    const totalScore = masterPlayer.gameHistory.reduce((sum, game) => sum + (game.score || 0), 0);
    masterPlayer.averageScore = totalScore / masterPlayer.gamesPlayed;

    if (masterPlayer.averageScore > 0) {
      masterPlayer.scoreToAverageRatio = masterPlayer.bestScore / masterPlayer.averageScore;
    } else {
      masterPlayer.scoreToAverageRatio = null;
    }
  }
}

function mergeUpgradesState(masterUpgrades, slaveUpgrades) {
  if (!masterUpgrades || !slaveUpgrades) {
    return;
  }

  for (const field of UPGRADE_LEVEL_FIELDS) {
    masterUpgrades[field] = Math.max(masterUpgrades[field] || 0, slaveUpgrades[field] || 0);
  }

  masterUpgrades.freeRidesRemaining = Math.max(masterUpgrades.freeRidesRemaining || 0, slaveUpgrades.freeRidesRemaining || 0);
  masterUpgrades.paidRidesRemaining = (masterUpgrades.paidRidesRemaining || 0) + (slaveUpgrades.paidRidesRemaining || 0);

  const masterRecentSessions = Array.isArray(masterUpgrades.recentRideSessionIds) ? masterUpgrades.recentRideSessionIds : [];
  const slaveRecentSessions = Array.isArray(slaveUpgrades.recentRideSessionIds) ? slaveUpgrades.recentRideSessionIds : [];
  masterUpgrades.recentRideSessionIds = [...new Set([...masterRecentSessions, ...slaveRecentSessions])].slice(-30);
}

/**
 * Получить или создать primaryId для Telegram пользователя
 */
async function getOrCreateTelegramAccount(telegramId) {
  const tgIdStr = String(telegramId);

  // Ищем существующую связку
  let link = await AccountLink.findOne({ telegramId: tgIdStr });

  if (link) {
    return buildAccountSummary({
      primaryId: link.primaryId,
      telegramId: link.telegramId,
      wallet: link.wallet,
      isLinked: !!link.wallet
    });
  }

  // Создаём новую
  const primaryId = `tg_${tgIdStr}`;
  link = buildAccountLink({ primaryId, telegramId: tgIdStr });
  await link.save();

  await ensureAccountResources(primaryId);

  return buildAccountSummary({ primaryId, telegramId: tgIdStr });
}

/**
 * Получить или создать primaryId для Wallet пользователя
 */
async function getOrCreateWalletAccount(walletAddress) {
  const wallet = walletAddress.toLowerCase();

  let link = await AccountLink.findOne({ wallet });

  if (link) {
    return buildAccountSummary({
      primaryId: link.primaryId,
      telegramId: link.telegramId,
      wallet: link.wallet,
      isLinked: !!link.telegramId
    });
  }

  // Создаём новую связку — primaryId = адрес кошелька
  const primaryId = wallet;
  link = buildAccountLink({ primaryId, wallet });
  await link.save();

  await ensureAccountResources(primaryId);

  return buildAccountSummary({ primaryId, wallet });
}

/**
 * Резолв primaryId из любого идентификатора (telegramId или wallet)
 */
async function resolvePrimaryId(identifier) {
  // Пробуем как wallet
  let link = await AccountLink.findOne({ wallet: identifier.toLowerCase() });
  if (link) return link.primaryId;

  // Пробуем как telegramId
  link = await AccountLink.findOne({ telegramId: String(identifier) });
  if (link) return link.primaryId;

  // Пробуем как primaryId напрямую
  link = await AccountLink.findOne({ primaryId: identifier.toLowerCase() });
  if (link) return link.primaryId;

  return null;
}

/**
 * Привязать Telegram к Wallet аккаунту (или наоборот).
 * Мерджит данные — аккаунт с лучшим score становится мастером.
 *
 * @param {string} existingIdentifier - текущий primaryId аккаунта
 * @param {string} linkType - "telegram" или "wallet"
 * @param {string} linkValue - telegramId или wallet адрес
 * @returns {object} результат привязки
 */
async function linkAccounts(existingIdentifier, linkType, linkValue) {
  // Находим текущую связку
  let currentLink = await AccountLink.findOne({ primaryId: existingIdentifier });
  if (!currentLink) {
    return { success: false, error: 'Current account not found' };
  }

  // Проверяем что ещё не привязано
  if (linkType === 'telegram' && currentLink.telegramId) {
    return { success: false, error: 'Telegram already linked to this account' };
  }
  if (linkType === 'wallet' && currentLink.wallet) {
    return { success: false, error: 'Wallet already linked to this account' };
  }

  const linkValueNorm = linkType === 'wallet' ? linkValue.toLowerCase() : String(linkValue);

  // Проверяем что привязываемый идентификатор не занят другим аккаунтом
  let otherLink = null;
  if (linkType === 'telegram') {
    otherLink = await AccountLink.findOne({ telegramId: linkValueNorm });
  } else {
    otherLink = await AccountLink.findOne({ wallet: linkValueNorm });
  }

  if (otherLink && otherLink.primaryId === currentLink.primaryId) {
    return { success: false, error: 'Already linked to this account' };
  }

  // Если привязываемый идентификатор уже имеет свой аккаунт — МЕРДЖ
  if (otherLink) {
    const mergeResult = await mergeAccounts(currentLink.primaryId, otherLink.primaryId);
    return mergeResult;
  }

  // Простая привязка — второй аккаунт не существует
  if (linkType === 'telegram') {
    currentLink.telegramId = linkValueNorm;
  } else {
    currentLink.wallet = linkValueNorm;
  }

  currentLink.linkedAt = new Date();
  currentLink.updatedAt = new Date();
  await currentLink.save();

  return {
    success: true,
    primaryId: currentLink.primaryId,
    telegramId: currentLink.telegramId,
    wallet: currentLink.wallet,
    merged: false
  };
}

/**
 * Мерджит два аккаунта.
 * Мастер = аккаунт с лучшим bestScore.
 * Slave данные обнуляются.
 */
async function mergeAccounts(primaryIdA, primaryIdB) {
  const playerA = await Player.findOne({ wallet: primaryIdA });
  const playerB = await Player.findOne({ wallet: primaryIdB });

  if (!playerA || !playerB) {
    return { success: false, error: 'One or both players not found' };
  }

  const linkA = await AccountLink.findOne({ primaryId: primaryIdA });
  const linkB = await AccountLink.findOne({ primaryId: primaryIdB });

  if (!linkA || !linkB) {
    return { success: false, error: 'One or both account links not found' };
  }

  // Определяем мастера по bestScore
  let masterLink, slaveLink, masterPlayer, slavePlayer;

  if ((playerA.bestScore || 0) >= (playerB.bestScore || 0)) {
    masterLink = linkA;
    slaveLink = linkB;
    masterPlayer = playerA;
    slavePlayer = playerB;
  } else {
    masterLink = linkB;
    slaveLink = linkA;
    masterPlayer = playerB;
    slavePlayer = playerA;
  }

  logger.info({
    masterPrimaryId: masterLink.primaryId,
    masterScore: masterPlayer.bestScore,
    slavePrimaryId: slaveLink.primaryId,
    slaveScore: slavePlayer.bestScore
  }, 'Account merge started');

  // Переносим идентификаторы с slave на master
  if (slaveLink.telegramId && !masterLink.telegramId) {
    masterLink.telegramId = slaveLink.telegramId;
  }
  if (slaveLink.wallet && !masterLink.wallet) {
    masterLink.wallet = slaveLink.wallet;
  }

  masterLink.linkedAt = new Date();
  masterLink.updatedAt = new Date();
  masterLink.masterSource = String(masterLink.primaryId || '').startsWith('tg_') ? 'telegram' : 'wallet';

  // Объединяем player/upgrades данные в master, затем обнуляем slave
  const masterUpgrades = await PlayerUpgrades.findOne({ wallet: masterLink.primaryId });
  const slaveUpgrades = await PlayerUpgrades.findOne({ wallet: slaveLink.primaryId });

  mergePlayerState(masterPlayer, slavePlayer);
  masterPlayer.updatedAt = new Date();
  await masterPlayer.save();

  if (masterUpgrades && slaveUpgrades) {
    mergeUpgradesState(masterUpgrades, slaveUpgrades);
    masterUpgrades.updatedAt = new Date();
    await masterUpgrades.save();
  }

  // Обнуляем slave
  if (slavePlayer) {
    resetPlayerState(slavePlayer);
    await slavePlayer.save();
  }

  if (slaveUpgrades) {
    resetUpgradesState(slaveUpgrades);
    await slaveUpgrades.save();
  }

  // Удаляем slave связку
  await AccountLink.deleteOne({ primaryId: slaveLink.primaryId });

  // Сохраняем master
  await masterLink.save();

  logger.info({
    masterPrimaryId: masterLink.primaryId,
    telegramId: masterLink.telegramId,
    wallet: masterLink.wallet
  }, 'Account merge completed');

  return {
    success: true,
    primaryId: masterLink.primaryId,
    telegramId: masterLink.telegramId,
    wallet: masterLink.wallet,
    merged: true,
    masterScore: masterPlayer.bestScore,
    slaveScoreWas: slavePlayer ? slavePlayer.bestScore : 0
  };
}

module.exports = {
  getOrCreateTelegramAccount,
  getOrCreateWalletAccount,
  resolvePrimaryId,
  linkAccounts,
  mergeAccounts
};
