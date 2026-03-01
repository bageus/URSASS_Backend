const express = require('express');
const router = express.Router();
const Player = require('../models/Player');
const PlayerUpgrades = require('../models/PlayerUpgrades');
const { UPGRADES_CONFIG, calculateEffects } = require('../utils/upgradesConfig');
const { verifySignature } = require('../utils/verifySignature');
const { saveResultLimiter, leaderboardLimiter } = require('../middleware/rateLimiter');

/**
 * GET /api/store/upgrades/:wallet
 * Получить все апгрейды игрока + рассчитанные эффекты
 */
router.get('/upgrades/:wallet', leaderboardLimiter, async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();

    if (!wallet.match(/^0x[a-f0-9]{40}$/i)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Ищем или создаём запись
    let upgrades = await PlayerUpgrades.findOne({ wallet });
    if (!upgrades) {
      upgrades = new PlayerUpgrades({ wallet });
      await upgrades.save();
    }

    // Баланс игрока
    const player = await Player.findOne({ wallet });
    const gold = player ? player.totalGoldCoins : 0;
    const silver = player ? player.totalSilverCoins : 0;

    // Рассчитанные эффекты
    const effects = calculateEffects(upgrades);

    // Формируем ответ с уровнями и ценами
    const upgradesData = {};
    for (const key in UPGRADES_CONFIG) {
      const config = UPGRADES_CONFIG[key];
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
    }

    res.json({
      wallet,
      balance: { gold, silver },
      upgrades: upgradesData,
      activeEffects: effects
    });

  } catch (error) {
    console.error('❌ GET /upgrades error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/store/buy
 * Купить апгрейд
 *
 * Body: { wallet, upgradeKey, tier, signature, timestamp }
 * tier: для tiered = 0/1/2 (какой тир покупаем), для consumable = 0
 */
router.post('/buy', saveResultLimiter, async (req, res) => {
  try {
    const { wallet, upgradeKey, tier, signature, timestamp } = req.body;

    // === ВАЛИДАЦИЯ ===
    if (!wallet || !upgradeKey || tier === undefined || !signature || !timestamp) {
      return res.status(400).json({
        error: 'Missing fields: wallet, upgradeKey, tier, signature, timestamp'
      });
    }

    const walletLower = wallet.toLowerCase();

    // Проверяем что upgradeKey существует
    const config = UPGRADES_CONFIG[upgradeKey];
    if (!config) {
      return res.status(400).json({ error: `Unknown upgrade: ${upgradeKey}` });
    }

    // Проверяем timestamp (не старше 5 минут)
    const now = Date.now();
    const timeDiff = now - timestamp;
    if (timeDiff < 0 || timeDiff > 5 * 60 * 1000) {
      return res.status(400).json({ error: 'Invalid timestamp' });
    }

    // === ВЕРИФИКАЦИЯ ПОДПИСИ ===
    const message = `Buy upgrade\nWallet: ${walletLower}\nUpgrade: ${upgradeKey}\nTier: ${tier}\nTimestamp: ${timestamp}`;
    const isValid = verifySignature(message, signature, walletLower);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // === ЗАГРУЖАЕМ ДАННЫЕ ===
    const player = await Player.findOne({ wallet: walletLower });
    if (!player) {
      return res.status(404).json({ error: 'Player not found. Play at least one game first.' });
    }

    let upgrades = await PlayerUpgrades.findOne({ wallet: walletLower });
    if (!upgrades) {
      upgrades = new PlayerUpgrades({ wallet: walletLower });
    }

    const currentLevel = upgrades[upgradeKey] || 0;

    // === ЛОГИКА ПОКУПКИ ===

    if (config.type === "tiered") {
      // Тировый апгрейд: tier должен == currentLevel (покупаем следующий)
      if (tier !== currentLevel) {
        return res.status(400).json({
          error: `Must buy tier ${currentLevel} first. Current level: ${currentLevel}, requested: ${tier}`
        });
      }

      if (currentLevel >= config.maxLevel) {
        return res.status(400).json({ error: 'Already at max level' });
      }

      const price = config.prices[tier];

      // Проверяем баланс
      if (config.currency === "silver") {
        if (player.totalSilverCoins < price) {
          return res.status(400).json({
            error: `Not enough silver. Need: ${price}, have: ${player.totalSilverCoins}`
          });
        }
        player.totalSilverCoins -= price;
      } else {
        if (player.totalGoldCoins < price) {
          return res.status(400).json({
            error: `Not enough gold. Need: ${price}, have: ${player.totalGoldCoins}`
          });
        }
        player.totalGoldCoins -= price;
      }

      // Повышаем уровень
      upgrades[upgradeKey] = currentLevel + 1;

      console.log(`🛒 ${walletLower} bought ${upgradeKey} tier ${tier + 1}/${config.maxLevel} for ${price} ${config.currency}`);

    } else if (config.type === "consumable") {
      // Одноразовый: можно покупать если текущее значение = 0
      // shield: 0 → 1 (на одну игру)
      // rides_pack: += 3

      const price = config.prices[0];

      if (config.currency === "gold") {
        if (player.totalGoldCoins < price) {
          return res.status(400).json({
            error: `Not enough gold. Need: ${price}, have: ${player.totalGoldCoins}`
          });
        }
        player.totalGoldCoins -= price;
      } else {
        if (player.totalSilverCoins < price) {
          return res.status(400).json({
            error: `Not enough silver. Need: ${price}, have: ${player.totalSilverCoins}`
          });
        }
        player.totalSilverCoins -= price;
      }

      if (upgradeKey === "shield") {
        if (upgrades.shield > 0) {
          return res.status(400).json({ error: 'Shield already purchased for next game' });
        }
        upgrades.shield = 1;
      } else if (upgradeKey === "rides_pack") {
        upgrades.rides_pack += 3;
      }

      console.log(`🛒 ${walletLower} bought consumable ${upgradeKey} for ${price} ${config.currency}`);

    } else {
      return res.status(400).json({ error: 'Unknown upgrade type' });
    }

    // === СОХРАНЯЕМ ===
    upgrades.updatedAt = new Date();
    player.updatedAt = new Date();

    await upgrades.save();
    await player.save();

    // Пересчитываем эффекты
    const effects = calculateEffects(upgrades);

    res.json({
      success: true,
      message: `Purchased ${upgradeKey}${config.type === "tiered" ? ` tier ${tier + 1}` : ''}`,
      balance: {
        gold: player.totalGoldCoins,
        silver: player.totalSilverCoins
      },
      upgradeLevel: upgrades[upgradeKey],
      activeEffects: effects
    });

  } catch (error) {
    console.error('❌ POST /buy error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/store/consume-shield
 * Списать щит после начала игры (вызывается фронтендом при старте)
 */
router.post('/consume-shield', saveResultLimiter, async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) return res.status(400).json({ error: 'Missing wallet' });

    const walletLower = wallet.toLowerCase();
    const upgrades = await PlayerUpgrades.findOne({ wallet: walletLower });

    if (!upgrades || upgrades.shield <= 0) {
      return res.json({ consumed: false, message: 'No shield to consume' });
    }

    upgrades.shield = 0;
    upgrades.updatedAt = new Date();
    await upgrades.save();

    console.log(`🛡 Shield consumed for ${walletLower}`);

    res.json({ consumed: true, message: 'Shield consumed' });

  } catch (error) {
    console.error('❌ POST /consume-shield error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
