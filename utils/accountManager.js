const AccountLink = require('../models/AccountLink');
const Player = require('../models/Player');
const PlayerUpgrades = require('../models/PlayerUpgrades');

/**
 * Получить или создать primaryId для Telegram пользователя
 */
async function getOrCreateTelegramAccount(telegramId) {
  const tgIdStr = String(telegramId);

  // Ищем существующую связку
  let link = await AccountLink.findOne({ telegramId: tgIdStr });

  if (link) {
    return {
      primaryId: link.primaryId,
      telegramId: link.telegramId,
      wallet: link.wallet,
      isLinked: !!link.wallet
    };
  }

  // Создаём новую
  const primaryId = `tg_${tgIdStr}`;
  link = new AccountLink({
    telegramId: tgIdStr,
    wallet: null,
    primaryId: primaryId,
    masterSource: null,
    linkedAt: null
  });
  await link.save();

  // Создаём пустого игрока
  let player = await Player.findOne({ wallet: primaryId });
  if (!player) {
    player = new Player({
      wallet: primaryId,
      bestScore: 0,
      bestDistance: 0,
      totalGoldCoins: 0,
      totalSilverCoins: 0,
      gamesPlayed: 0,
      gameHistory: []
    });
    await player.save();
  }

  // Создаём пустые апгрейды
  let upgrades = await PlayerUpgrades.findOne({ wallet: primaryId });
  if (!upgrades) {
    upgrades = new PlayerUpgrades({ wallet: primaryId });
    await upgrades.save();
  }

  return {
    primaryId,
    telegramId: tgIdStr,
    wallet: null,
    isLinked: false
  };
}

/**
 * Получить или создать primaryId для Wallet пользователя
 */
async function getOrCreateWalletAccount(walletAddress) {
  const wallet = walletAddress.toLowerCase();

  let link = await AccountLink.findOne({ wallet });

  if (link) {
    return {
      primaryId: link.primaryId,
      telegramId: link.telegramId,
      wallet: link.wallet,
      isLinked: !!link.telegramId
    };
  }

  // Создаём новую связку — primaryId = адрес кошелька
  const primaryId = wallet;
  link = new AccountLink({
    telegramId: null,
    wallet: wallet,
    primaryId: primaryId,
    masterSource: null,
    linkedAt: null
  });
  await link.save();

  // Проверяем/создаём игрока (может уже существовать от старого кода)
  let player = await Player.findOne({ wallet: primaryId });
  if (!player) {
    player = new Player({
      wallet: primaryId,
      bestScore: 0,
      bestDistance: 0,
      totalGoldCoins: 0,
      totalSilverCoins: 0,
      gamesPlayed: 0,
      gameHistory: []
    });
    await player.save();
  }

  let upgrades = await PlayerUpgrades.findOne({ wallet: primaryId });
  if (!upgrades) {
    upgrades = new PlayerUpgrades({ wallet: primaryId });
    await upgrades.save();
  }

  return {
    primaryId,
    telegramId: null,
    wallet,
    isLinked: false
  };
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

  console.log(`🔗 MERGE: Master=${masterLink.primaryId} (score=${masterPlayer.bestScore}), Slave=${slaveLink.primaryId} (score=${slavePlayer.bestScore})`);

  // Переносим идентификаторы с slave на master
  if (slaveLink.telegramId && !masterLink.telegramId) {
    masterLink.telegramId = slaveLink.telegramId;
  }
  if (slaveLink.wallet && !masterLink.wallet) {
    masterLink.wallet = slaveLink.wallet;
  }

  masterLink.linkedAt = new Date();
  masterLink.updatedAt = new Date();
  masterLink.masterSource = masterLink.primaryId === primaryIdA ? 'a' : 'b';

  // Переносим апгрейды мастера (slave обнуляется)
  const masterUpgrades = await PlayerUpgrades.findOne({ wallet: masterLink.primaryId });
  const slaveUpgrades = await PlayerUpgrades.findOne({ wallet: slaveLink.primaryId });

  // Обнуляем slave
  if (slavePlayer) {
    slavePlayer.bestScore = 0;
    slavePlayer.bestDistance = 0;
    slavePlayer.totalGoldCoins = 0;
    slavePlayer.totalSilverCoins = 0;
    slavePlayer.gamesPlayed = 0;
    slavePlayer.gameHistory = [];
    await slavePlayer.save();
  }

  if (slaveUpgrades) {
    slaveUpgrades.x2_duration = 0;
    slaveUpgrades.score_plus_300_mult = 0;
    slaveUpgrades.score_plus_500_mult = 0;
    slaveUpgrades.score_minus_300_mult = 0;
    slaveUpgrades.score_minus_500_mult = 0;
    slaveUpgrades.invert_score = 0;
    slaveUpgrades.speed_up_mult = 0;
    slaveUpgrades.speed_down_mult = 0;
    slaveUpgrades.magnet_duration = 0;
    slaveUpgrades.spin_cooldown = 0;
    slaveUpgrades.shield = 0;
    slaveUpgrades.radar = 0;
    slaveUpgrades.alert = 0;
    slaveUpgrades.freeRidesRemaining = 0;
    slaveUpgrades.paidRidesRemaining = 0;
    await slaveUpgrades.save();
  }

  // Удаляем slave связку
  await AccountLink.deleteOne({ primaryId: slaveLink.primaryId });

  // Сохраняем master
  await masterLink.save();

  console.log(`✅ MERGE COMPLETE: Master=${masterLink.primaryId}, TG=${masterLink.telegramId}, Wallet=${masterLink.wallet}`);

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
