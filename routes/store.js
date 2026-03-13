const express = require('express');
const router = express.Router();
const Player = require('../models/Player');
const PlayerUpgrades = require('../models/PlayerUpgrades');
const AccountLink = require('../models/AccountLink');
const { UPGRADES_CONFIG, calculateEffects } = require('../utils/upgradesConfig');
const { verifySignature } = require('../utils/verifySignature');
const { writeLimiter, readLimiter } = require('../middleware/rateLimiter');
const SecurityEvent = require('../models/SecurityEvent');
const logger = require('../utils/logger');
const { markSuspicious } = require('../middleware/requestMetrics');


async function logSecurityEvent({ wallet = null, eventType, route, ipAddress, details = {} }) {
  try {
    await SecurityEvent.create({ wallet, eventType, route, ipAddress, details });
  } catch (error) {
    logger.warn({ error: error.message, eventType }, 'Failed to persist SecurityEvent');
  }
}

/**
 * GET /api/store/upgrades/:wallet
 * Get all upgrades + rides + effects
 */
router.get('/upgrades/:wallet', readLimiter, async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();

    if (!wallet || wallet.length < 3) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    let upgrades = await PlayerUpgrades.findOne({ wallet });
    if (!upgrades) {
      upgrades = new PlayerUpgrades({ wallet });
      await upgrades.save();
    }

    // Refresh free rides
    const changed = upgrades.refreshFreeRides();
    if (changed) {
      await upgrades.save();
    }

    const player = await Player.findOne({ wallet });
    const gold = player ? player.totalGoldCoins : 0;
    const silver = player ? player.totalSilverCoins : 0;

    const effects = calculateEffects(upgrades);

    // Build upgrades data
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

    // Rides data
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
 * Buy an upgrade or ride pack
 */
router.post('/buy', writeLimiter, async (req, res) => {
  try {
    const { wallet, upgradeKey, tier, signature, timestamp, authMode, telegramId } = req.body;

    const isTelegramAuth = authMode === 'telegram';

    if (isTelegramAuth) {
      if (!wallet || !upgradeKey || !telegramId || !timestamp) {
        return res.status(400).json({
          error: 'Missing fields: wallet, upgradeKey, telegramId, timestamp'
        });
      }
    } else {
      if (!wallet || !upgradeKey || !signature || !timestamp) {
        return res.status(400).json({
          error: 'Missing fields: wallet, upgradeKey, signature, timestamp'
        });
      }
    }

    const walletLower = wallet.toLowerCase();

    const recentBuyCount = await SecurityEvent.countDocuments({
          wallet: walletLower,
          eventType: 'purchase_attempt',
          createdAt: { $gte: new Date(Date.now() - 2 * 60 * 1000) }
        });
    
        if (recentBuyCount >= 12) {
          markSuspicious('rapid_purchases');
          await logSecurityEvent({
            wallet: walletLower,
            eventType: 'suspicious_rapid_purchases',
            route: req.path,
            ipAddress: req.ip,
            details: { recentBuyCount }
          });
          logger.warn({ wallet: walletLower, recentBuyCount }, 'Suspicious rapid purchase pattern');
        }

    
    const config = UPGRADES_CONFIG[upgradeKey];
    if (!config) {
      return res.status(400).json({ error: `Unknown upgrade: ${upgradeKey}` });
    }

    // Timestamp validation
    const ts = typeof timestamp === 'number' ? timestamp : parseInt(timestamp, 10);

    if (!ts || isNaN(ts)) {
      return res.status(400).json({ error: 'Invalid timestamp format' });
    }

    const now = Date.now();
    const timeDiff = Math.abs(now - ts);
    if (timeDiff > 10 * 60 * 1000) {
      return res.status(400).json({ error: `Invalid timestamp. Diff: ${timeDiff}ms` });
    }

    if (isTelegramAuth) {
      // Verify that the telegramId matches the claimed primaryId (wallet) via AccountLink
      const link = await AccountLink.findOne({ telegramId: String(telegramId) });
      if (!link || link.primaryId !== walletLower) {
        return res.status(401).json({ error: 'Telegram identity verification failed' });
      }
    } else {
      // Signature verification
      const message = `Buy upgrade\nWallet: ${walletLower}\nUpgrade: ${upgradeKey}\nTier: ${tier !== undefined ? tier : 0}\nTimestamp: ${ts}`;
      const isValid = verifySignature(message, signature, walletLower);

      if (!isValid) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    // Player data
    const player = await Player.findOne({ wallet: walletLower });
    if (!player) {
      return res.status(404).json({ error: 'Player not found. Play at least one game first.' });
    }

    let upgrades = await PlayerUpgrades.findOne({ wallet: walletLower });
    if (!upgrades) {
      upgrades = new PlayerUpgrades({ wallet: walletLower });
    }

    // Refresh free rides
    upgrades.refreshFreeRides();

    // === PURCHASE LOGIC BY TYPE ===

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

    // Save
    upgrades.updatedAt = new Date();
    player.updatedAt = new Date();

    await upgrades.save();
    await player.save();

    const effects = calculateEffects(upgrades);

    // Rides data
    const nowDate = new Date();
    const resetAt = upgrades.freeRidesResetAt || nowDate;
    const msUntilReset = Math.max(0, (8 * 60 * 60 * 1000) - (nowDate - resetAt));

    await logSecurityEvent({
      wallet: walletLower,
      eventType: 'purchase_attempt',
      route: req.path,
      ipAddress: req.ip,
      details: { upgradeKey, tier: tier ?? 0, authMode: authMode || 'wallet' }
    });

    logger.info({ wallet: walletLower, upgradeKey, tier: tier ?? 0 }, 'Purchase processed');


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
    logger.error({ err: error }, 'POST /buy error');
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/store/consume-ride
 * Consume 1 ride when starting a game (anti-cheat protected by rideSessionId)
 */
const consumeRideHandler = async (req, res) => {
  try {
    const { wallet, rideSessionId } = req.body;
    if (!wallet) return res.status(400).json({ error: 'Missing wallet' });

    const walletLower = wallet.toLowerCase();
    const isLegacyUseRideRoute = req.path === '/use-ride';

    let sessionId = null;
    if (rideSessionId && typeof rideSessionId === 'string' && rideSessionId.trim().length >= 8) {
      sessionId = rideSessionId.trim();
    } else if (!isLegacyUseRideRoute) {
      return res.status(400).json({
        error: 'Missing or invalid rideSessionId',
        details: 'Pass a unique rideSessionId for every game start to enable anti-cheat duplicate protection.'
      });
    }
    let upgrades = await PlayerUpgrades.findOne({ wallet: walletLower });
    if (!upgrades) {
      upgrades = new PlayerUpgrades({ wallet: walletLower });
    }

    // Refresh free rides
    upgrades.refreshFreeRides();
    
    upgrades.recentRideSessionIds = upgrades.recentRideSessionIds || [];

    if (upgrades.recentRideSessionIds.includes(sessionId)) {
      markSuspicious('duplicate_ride_session');
      await logSecurityEvent({
        wallet: walletLower,
        eventType: 'duplicate_ride_session',
        route: req.path,
        ipAddress: req.ip,
        details: { rideSessionId: sessionId }
      });

      return res.status(409).json({
        error: 'Ride already consumed for this session',
        antiCheatTriggered: true,
        rides: {
          freeRides: upgrades.freeRidesRemaining,
          paidRides: upgrades.paidRidesRemaining,
          totalRides: upgrades.getTotalRides()
        }
      });
    }

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

    // Consume 1 ride
    const consumed = upgrades.consumeRide();
    if (!consumed) {
      return res.status(403).json({ error: 'Failed to consume ride' });
    }
    
   if (sessionId) {
      upgrades.recentRideSessionIds.push(sessionId);
      if (upgrades.recentRideSessionIds.length > 30) {
        upgrades.recentRideSessionIds = upgrades.recentRideSessionIds.slice(-30);
      }
    }



    upgrades.updatedAt = new Date();
    await upgrades.save();

    const nowDate = new Date();
    const resetAt = upgrades.freeRidesResetAt || nowDate;
    const msUntilReset = Math.max(0, (8 * 60 * 60 * 1000) - (nowDate - resetAt));

    console.log(`🎟 ${walletLower} used 1 ride. Free: ${upgrades.freeRidesRemaining}, Paid: ${upgrades.paidRidesRemaining}`);
    

    const antiCheat = sessionId
      ? { duplicateSessionCheck: true, rideSessionId: sessionId }
      : { duplicateSessionCheck: false, warning: 'Legacy /use-ride call without rideSessionId. Please migrate to /consume-ride with rideSessionId.' };

    res.json({
      success: true,
      antiCheat,
      rides: {
        freeRides: upgrades.freeRidesRemaining,
        paidRides: upgrades.paidRidesRemaining,
        totalRides: upgrades.getTotalRides(),
        resetInMs: upgrades.freeRidesRemaining < 3 ? msUntilReset : 0,
        resetInFormatted: formatTimeLeft(msUntilReset)
      }
    });

  } catch (error) {
    logger.error({ err: error }, 'POST /consume-ride error');
    res.status(500).json({ error: 'Server error' });
  }
};

router.post('/consume-ride', writeLimiter, consumeRideHandler);
router.post('/use-ride', writeLimiter, consumeRideHandler);

/**
 * GET /api/store/rides/:wallet
 * Get rides info
 */
router.get('/rides/:wallet', readLimiter, async (req, res) => {
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
    logger.error({ err: error }, 'GET /rides/:wallet error');
    res.status(500).json({ error: 'Server error' });
  }
});

function formatTimeLeft(ms) {
  if (ms <= 0) return 'Ready now';

  const totalSeconds = Math.ceil(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

module.exports = router;
