const express = require('express');
const router = express.Router();
const Player = require('../models/Player');
const PlayerUpgrades = require('../models/PlayerUpgrades');
const { UPGRADES_CONFIG, calculateEffects } = require('../utils/upgradesConfig');
const { verifySignature } = require('../utils/verifySignature');
const { saveResultLimiter, leaderboardLimiter } = require('../middleware/rateLimiter');

/**
 * GET /api/store/upgrades/:wallet
 * Получить все апгрейды + заезды + эффекты
 */
router.get('/upgrades/:wallet', leaderboardLimiter, async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();

    if (!wallet.match(/^0x[a-f0-9]{40}$/i)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    let upgrades = await PlayerUpgrades.findOne({ wallet });
    if (!upgrades) {
      upgrades = new PlayerUpgrades({ wallet });
      await upgrades.save();
    }

    // Пересчитываем бесплатные заезды
    const changed = upgrades.refreshFreeRides();
    if (changed) {
      await upgrades.save();
    }

    const player = await Player.findOne({ wallet });
    const gold = player ? player.totalGoldCoins : 0;
    const silver = player ? player.totalSilverCoins : 0;

    const effects = calculateEffects(upgrades);

    // Формируем данные апгрейдов
    const upgradesData = {};
    for (const key in UPGRADES_CONFIG) {
      const config = UPGRADES_CONFIG[key];

      if (config.type === "tiered" || config.type === "permanent") {
        const currentLevel = upgrades[key] || 0;
        upgradesData[key] = {
          type: config.type,
          currency: config.currency,
          maxLevel: config.maxLevel,
          currentLevel: currentLevel,
          prices: config.prices,
          effects: config.effects,
          description: config.description,
          nextPrice: currentLevel < config.maxLevel ? config.prices[currentLevel] : null,
          isMaxed: currentLevel >= config.maxLevel
        };
      } else if (config.type === "rides") {
        upgradesData[key] = {
          type: "rides",
          currency: config.currency,
          price: config.price,
          amount: config.amount,
          description: config.description
        };
      }
    }

    // Данные о заездах
    const now = new Date();
    const resetAt = upgrades.freeRidesResetAt || now;
    const msUntilReset = Math.max(0, (8 * 60 * 60 * 1000) - (now - resetAt));

    const ridesData = {
      freeRides: upgrades.freeRidesRemaining,
      paidRides: upgrades.paidRidesRemaining,
      totalRides: upgrades.getTotalRides(),
      maxFreeRides: 3,
      resetInMs: upgrades.freeRidesRemaining < 3 ? msUntilReset : 0,
      resetInFormatted: formatTimeLeft(msUntilReset)
    };

    res.json({
      wallet,
      balance: { gold, silver },
      upgrades: upgradesData,
      rides: ridesData,
      activeEffects: effects
    });

  } catch (error) {
    console.error('❌ GET /upgrades error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/store/buy
 * Купить апгрейд или пак заездов
 */
router.post('/buy', saveResultLimiter, async (req, res) => {
  try {
    const { wallet, upgradeKey, tier, signature, timestamp } = req.body;

    if (!wallet || !upgradeKey || !signature || !timestamp) {
      return res.status(400).json({
        error: 'Missing fields: wallet, upgradeKey, signature, timestamp'
      });
    }

    const walletLower = wallet.toLowerCase();

    const config = UPGRADES_CONFIG[upgradeKey];
    if (!config) {
      return res.status(400).json({ error: `Unknown upgrade: ${upgradeKey}` });
    }

    // Timestamp проверка
    const ts = typeof timestamp === 'number' ? timestamp : parseInt(timestamp, 10);
    if (!ts || isNaN(ts)) {
      return res.status(400).json({ error: 'Invalid timestamp format' });
    }
    const now = Date.now();
    const timeDiff = Math.abs(now - ts);
    if (timeDiff > 10 * 60 * 1000) {
      return res.status(400).json({ error: `Invalid timestamp. Diff: ${timeDiff}ms` });
    }

    // Подпись
    const message = `Buy upgrade\nWallet: ${walletLower}\nUpgrade: ${upgradeKey}\nTier: ${tier !== undefined ? tier : 0}\nTimestamp: ${ts}`;
    const isValid = verifySignature(message, signature, walletLower);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Данные игрока
    const player = await Player.findOne({ wallet: walletLower });
    if (!player) {
      return res.status(404).json({ error: 'Player not found. Play at least one game first.' });
    }

    let upgrades = await PlayerUpgrades.findOne({ wallet: walletLower });
    if (!upgrades) {
      upgrades = new PlayerUpgrades({ wallet: walletLower });
    }

    // Пересчитываем бесплатные заезды
    upgrades.refreshFreeRides();

    // === ЛОГИКА ПО ТИПАМ ===

    if (config.type === "tiered") {
      const currentLevel = upgrades[upgradeKey] || 0;

      if (tier !== currentLevel) {
        return res.status(400).json({
          error: `Must buy tier ${currentLevel}. Current: ${currentLevel}, requested: ${tier}`
        });
      }
      if (currentLevel >= config.maxLevel) {
        return res.status(400).json({ error: 'Already at max level' });
      }

      const price = config.prices[tier];

      if (config.currency === "silver") {
        if (player.totalSilverCoins < price) {
          return res.status(400).json({ error: `Not enough silver. Need: ${price}, have: ${player.totalSilverCoins}` });
        }
        player.totalSilverCoins -= price;
      } else {
        if (player.totalGoldCoins < price) {
          return res.status(400).json({ error: `Not enough gold. Need: ${price}, have: ${player.totalGoldCoins}` });
        }
        player.totalGoldCoins -= price;
      }

      upgrades[upgradeKey] = currentLevel + 1;
      console.log(`🛒 ${walletLower} bought ${upgradeKey} tier ${currentLevel + 1}/${config.maxLevel} for ${price} ${config.currency}`);

    } else if (config.type === "permanent") {
      const currentLevel = upgrades[upgradeKey] || 0;

      if (currentLevel >= config.maxLevel) {
        return res.status(400).json({ error: 'Already purchased (permanent)' });
      }

      const price = config.prices[0];

      if (config.currency === "gold") {
        if (player.totalGoldCoins < price) {
          return res.status(400).json({ error: `Not enough gold. Need: ${price}, have: ${player.totalGoldCoins}` });
        }
        player.totalGoldCoins -= price;
      } else {
        if (player.totalSilverCoins < price) {
          return res.status(400).json({ error: `Not enough silver. Need: ${price}, have: ${player.totalSilverCoins}` });
        }
        player.totalSilverCoins -= price;
      }

      upgrades[upgradeKey] = 1;
      console.log(`🛒 ${walletLower} bought permanent ${upgradeKey} for ${price} ${config.currency}`);

    } else if (config.type === "rides") {
      const price = config.price;

      if (player.totalGoldCoins < price) {
        return res.status(400).json({ error: `Not enough gold. Need: ${price}, have: ${player.totalGoldCoins}` });
      }

      player.totalGoldCoins -= price;
      upgrades.paidRidesRemaining += config.amount;

      console.log(`🛒 ${walletLower} bought ${config.amount} rides for ${price} gold. Total paid rides: ${upgrades.paidRidesRemaining}`);

    } else {
      return res.status(400).json({ error: 'Unknown upgrade type' });
    }

    // Сохраняем
    upgrades.updatedAt = new Date();
    player.updatedAt = new Date();
    await upgrades.save();
    await player.save();

    const effects = calculateEffects(upgrades);

    // Данные о заездах
    const nowDate = new Date();
    const resetAt = upgrades.freeRidesResetAt || nowDate;
    const msUntilReset = Math.max(0, (8 * 60 * 60 * 1000) - (nowDate - resetAt));

    res.json({
      success: true,
      message: `Purchased ${upgradeKey}`,
      balance: {
        gold: player.totalGoldCoins,
        silver: player.totalSilverCoins
      },
      rides: {
        freeRides: upgrades.freeRidesRemaining,
        paidRides: upgrades.paidRidesRemaining,
        totalRides: upgrades.getTotalRides(),
        resetInMs: upgrades.freeRidesRemaining < 3 ? msUntilReset : 0,
        resetInFormatted: formatTimeLeft(msUntilReset)
      },
      activeEffects: effects
    });

  } catch (error) {
    console.error('❌ POST /buy error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/store/use-ride
 * Использовать 1 заезд при старте игры
 */
router.post('/use-ride', saveResultLimiter, async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) return res.status(400).json({ error: 'Missing wallet' });

    const walletLower = wallet.toLowerCase();

    let upgrades = await PlayerUpgrades.findOne({ wallet: walletLower });
    if (!upgrades) {
      upgrades = new PlayerUpgrades({ wallet: walletLower });
    }

    // Пересчитываем бесплатные
    upgrades.refreshFreeRides();

    const totalBefore = upgrades.getTotalRides();

    if (totalBefore <= 0) {
      const resetAt = upgrades.freeRidesResetAt || new Date();
      const msUntilReset = Math.max(0, (8 * 60 * 60 * 1000) - (new Date() - resetAt));

      return res.status(403).json({
        error: 'No rides remaining',
        rides: {
          freeRides: 0,
          paidRides: 0,
          totalRides: 0,
          resetInMs: msUntilReset,
          resetInFormatted: formatTimeLeft(msUntilReset)
        }
      });
    }

    // Списываем 1 заезд
    const consumed = upgrades.consumeRide();
    if (!consumed) {
      return res.status(403).json({ error: 'Failed to consume ride' });
    }

    upgrades.updatedAt = new Date();
    await upgrades.save();

    const nowDate = new Date();
    const resetAt = upgrades.freeRidesResetAt || nowDate;
    const msUntilReset = Math.max(0, (8 * 60 * 60 * 1000) - (nowDate - resetAt));

    console.log(`🎟 ${walletLower} used 1 ride. Free: ${upgrades.freeRidesRemaining}, Paid: ${upgrades.paidRidesRemaining}`);

    res.json({
      success: true,
      rides: {
        freeRides: upgrades.freeRidesRemaining,
        paidRides: upgrades.paidRidesRemaining,
        totalRides: upgrades.getTotalRides(),
        resetInMs: upgrades.freeRidesRemaining < 3 ? msUntilReset : 0,
        resetInFormatted: formatTimeLeft(msUntilReset)
      }
    });

  } catch (error) {
    console.error('❌ POST /use-ride error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/store/rides/:wallet
 * Получить информацию о заездах
 */
router.get('/rides/:wallet', leaderboardLimiter, async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();

    let upgrades = await PlayerUpgrades.findOne({ wallet });
    if (!upgrades) {
      upgrades = new PlayerUpgrades({ wallet });
      await upgrades.save();
    }

    upgrades.refreshFreeRides();
    await upgrades.save();

    const nowDate = new Date();
    const resetAt = upgrades.freeRidesResetAt || nowDate;
    const msUntilReset = Math.max(0, (8 * 60 * 60 * 1000) - (nowDate - resetAt));

    res.json({
      freeRides: upgrades.freeRidesRemaining,
      paidRides: upgrades.paidRidesRemaining,
      totalRides: upgrades.getTotalRides(),
      maxFreeRides: 3,
      resetInMs: upgrades.freeRidesRemaining < 3 ? msUntilReset : 0,
      resetInFormatted: formatTimeLeft(msUntilReset)
    });

  } catch (error) {
    console.error('❌ GET /rides error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Хелпер: форматирование времени
function formatTimeLeft(ms) {
  if (ms <= 0) return "Ready";
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

module.exports = router;
