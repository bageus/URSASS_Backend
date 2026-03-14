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
const { executeInTransaction } = require('../utils/transaction');


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
      const link = await AccountLink.findOne({ telegramId: String(telegramId) });
      if (!link || link.primaryId !== walletLower) {
        return res.status(401).json({ error: 'Telegram identity verification failed' });
      }
    } else {
      const message = `Buy upgrade
Wallet: ${walletLower}
Upgrade: ${upgradeKey}
Tier: ${tier !== undefined ? tier : 0}
Timestamp: ${ts}`;
      const isValid = verifySignature(message, signature, walletLower);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const result = await executeInTransaction(async (session) => {
      const sessionOpts = session ? { session } : {};

      const player = await Player.findOne({ wallet: walletLower }, null, sessionOpts);
      if (!player) {
        const err = new Error('Player not found. Play at least one game first.');
        err.status = 404;
        throw err;
      }

     let upgrades = await PlayerUpgrades.findOne({ wallet: walletLower }, null, sessionOpts);
      if (!upgrades) {
        upgrades = new PlayerUpgrades({ wallet: walletLower });
      }

      upgrades.refreshFreeRides();

     if (config.type === 'tiered') {
        const currentLevel = upgrades[upgradeKey] || 0;

        if (tier !== currentLevel) {
          const err = new Error(`Must buy tier ${currentLevel}. Current: ${currentLevel}, requested: ${tier}`);
          err.status = 400;
          throw err;
        }

      if (currentLevel >= config.maxLevel) {
          const err = new Error('Already at max level');
          err.status = 400;
          throw err;
        }

    const price = config.prices[tier];
        if (config.currency === 'silver') {
          if (player.totalSilverCoins < price) {
            const err = new Error(`Not enough silver. Need: ${price}, have: ${player.totalSilverCoins}`);
            err.status = 400;
            throw err;
          }
          player.totalSilverCoins -= price;
        } else {
          if (player.totalGoldCoins < price) {
            const err = new Error(`Not enough gold. Need: ${price}, have: ${player.totalGoldCoins}`);
            err.status = 400;
            throw err;
          }
          player.totalGoldCoins -= price;
        }

       upgrades[upgradeKey] = currentLevel + 1;
      } else if (config.type === 'permanent') {
        const currentLevel = upgrades[upgradeKey] || 0;
        if (currentLevel >= config.maxLevel) {
          const err = new Error('Already purchased (permanent)');
          err.status = 400;
          throw err;
        }

       const price = config.prices[0];
        if (config.currency === 'gold') {
          if (player.totalGoldCoins < price) {
            const err = new Error(`Not enough gold. Need: ${price}, have: ${player.totalGoldCoins}`);
            err.status = 400;
            throw err;
          }
          player.totalGoldCoins -= price;
        } else {
          if (player.totalSilverCoins < price) {
            const err = new Error(`Not enough silver. Need: ${price}, have: ${player.totalSilverCoins}`);
            err.status = 400;
            throw err;
          }
          player.totalSilverCoins -= price;
        }

        upgrades[upgradeKey] = 1;
      } else if (config.type === 'rides') {
        const price = config.price;
        if (player.totalGoldCoins < price) {
          const err = new Error(`Not enough gold. Need: ${price}, have: ${player.totalGoldCoins}`);
          err.status = 400;
          throw err;
        }
        
        player.totalGoldCoins -= price;
        upgrades.paidRidesRemaining += config.amount;
      } else {
        const err = new Error('Unknown upgrade type');
        err.status = 400;
        throw err;
      }

      upgrades.updatedAt = new Date();
      player.updatedAt = new Date();

    await upgrades.save(sessionOpts);
    await player.save(sessionOpts);

    await logSecurityEvent({
        wallet: walletLower,
        eventType: 'purchase_attempt',
        route: req.path,
        ipAddress: req.ip,
        details: { upgradeKey, tier: tier ?? 0, authMode: authMode || 'wallet' }
      });

    const effects = calculateEffects(upgrades);
      const nowDate = new Date();
      const resetAt = upgrades.freeRidesResetAt || nowDate;
      const msUntilReset = Math.max(0, (8 * 60 * 60 * 1000) - (nowDate - resetAt));

    return {
        gold: player.totalGoldCoins,
        silver: player.totalSilverCoins,
        freeRides: upgrades.freeRidesRemaining,
        paidRides: upgrades.paidRidesRemaining,
        totalRides: upgrades.getTotalRides(),
        resetInMs: upgrades.freeRidesRemaining < 3 ? msUntilReset : 0,
        resetInFormatted: formatTimeLeft(msUntilReset),
        activeEffects: effects
      };
    });

    logger.info({ wallet: walletLower, upgradeKey, tier: tier ?? 0 }, 'Purchase processed');

    res.json({
      success: true,
      message: `Purchased ${upgradeKey}`,
      balance: {
        gold: result.gold,
        silver: result.silver
      },
      rides: {
        freeRides: result.freeRides,
        paidRides: result.paidRides,
        totalRides: result.totalRides,
        resetInMs: result.resetInMs,
        resetInFormatted: result.resetInFormatted
      },
      activeEffects: result.activeEffects
    });
  } catch (error) {
       if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }

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
    const { wallet, rideSessionId, signature, timestamp, authMode, telegramId } = req.body;
    if (!wallet) return res.status(400).json({ error: 'Missing wallet' });

    const walletLower = wallet.toLowerCase();
    const isLegacyUseRideRoute = req.path === '/use-ride';
     const isTelegramAuth = authMode === 'telegram';
    
    
        const allowLegacyUnauth = process.env.LEGACY_USE_RIDE_NO_AUTH === 'true' && isLegacyUseRideRoute;
    
        if (!allowLegacyUnauth) {
          const ts = typeof timestamp === 'number' ? timestamp : parseInt(timestamp, 10);
          if (!ts || isNaN(ts)) {
            return res.status(400).json({ error: 'Invalid timestamp format' });
          }
    
          const timeDiff = Math.abs(Date.now() - ts);
          if (timeDiff > 10 * 60 * 1000) {
            return res.status(400).json({ error: `Invalid timestamp. Diff: ${timeDiff}ms` });
          }
    
          if (isTelegramAuth) {
            if (!telegramId) {
              return res.status(400).json({ error: 'Missing telegramId for telegram auth mode' });
            }
    
            const link = await AccountLink.findOne({ telegramId: String(telegramId) });
            if (!link || link.primaryId !== walletLower) {
              return res.status(401).json({ error: 'Telegram identity verification failed' });
            }
          } else {
            if (!signature) {
              return res.status(400).json({ error: 'Missing signature' });
            }
    
            const message = `Consume ride
    Wallet: ${walletLower}
    RideSessionId: ${rideSessionId || 'legacy'}
    Timestamp: ${ts}`;
            const isValid = verifySignature(message, signature, walletLower);
            if (!isValid) {
              return res.status(401).json({ error: 'Invalid signature' });
            }
          }
        } else {
          logger.warn({ wallet: walletLower }, 'Legacy unauthenticated /use-ride access enabled by env');
        }

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
