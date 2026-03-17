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
const { logSecurityEvent, normalizeWallet, validateTimestampWindow } = require('../utils/security');

const UPGRADE_KEY_ALIASES = {
  spin_alert: 'alert',
  start_with_alert: 'alert',
  start_with_radar: 'radar',
  spin_perfect: 'alert'
};

function resolveUpgradeKey(upgradeKey) {
  return UPGRADE_KEY_ALIASES[upgradeKey] || upgradeKey;
}

function normalizeShieldUpgrades(upgrades) {
  let changed = false;
  const legacyShieldLevel = upgrades.shield || 0;

  if (legacyShieldLevel > 1) {
    const currentCapacityLevel = typeof upgrades.shield_capacity === 'number' ? upgrades.shield_capacity : 0;
    const migratedCapacityLevel = Math.min(2, legacyShieldLevel - 1);

    if (currentCapacityLevel < migratedCapacityLevel) {
      upgrades.shield_capacity = migratedCapacityLevel;
      changed = true;
    }

    upgrades.shield = 1;
    changed = true;
  } else if (typeof upgrades.shield_capacity !== 'number') {
    upgrades.shield_capacity = 0;
    changed = true;
  }

  return changed;
}

/**
 * GET /api/store/upgrades/:wallet
 * Get all upgrades + rides + effects
 */
router.get('/upgrades/:wallet', readLimiter, async (req, res) => {
  try {
    const wallet = normalizeWallet(req.params.wallet);

    if (!wallet || wallet.length < 3) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    let upgrades = await PlayerUpgrades.findOne({ wallet });
    if (!upgrades) {
      upgrades = new PlayerUpgrades({ wallet });
      await upgrades.save();
    }

    // Refresh free rides + normalize legacy shield progression
    const changed = upgrades.refreshFreeRides();
    const shieldChanged = normalizeShieldUpgrades(upgrades);
    if (changed || shieldChanged) {
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

    if (upgradesData.alert && !upgradesData.spin_alert) {
      upgradesData.spin_alert = { ...upgradesData.alert };
    }
    if (upgradesData.radar && !upgradesData.start_with_radar) {
      upgradesData.start_with_radar = { ...upgradesData.radar };
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
    logger.error({ err: error }, 'GET /upgrades error');
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
    const requestedUpgradeKey = String(upgradeKey || '').trim();
    const resolvedUpgradeKey = resolveUpgradeKey(requestedUpgradeKey);

    const isTelegramAuth = authMode === 'telegram';

    if (isTelegramAuth) {
      if (!wallet || !requestedUpgradeKey || !telegramId || !timestamp) {
        return res.status(400).json({
          error: 'Missing fields: wallet, upgradeKey, telegramId, timestamp'
        });
      }
    } else {
      if (!wallet || !requestedUpgradeKey || !signature || !timestamp) {
        return res.status(400).json({
          error: 'Missing fields: wallet, upgradeKey, signature, timestamp'
        });
      }
    }

    const walletLower = normalizeWallet(wallet);
    const purchaseDetails = {
      requestedUpgradeKey,
      resolvedUpgradeKey,
      tier: tier ?? 0,
      authMode: authMode || 'wallet'
    };

    const logPurchaseResult = async (status, reason, details = {}) => {
      await logSecurityEvent({
        wallet: walletLower,
        eventType: 'purchase_result',
        route: req.path,
        ipAddress: req.ip,
        details: {
          ...purchaseDetails,
          status,
          reason,
          ...details
        }
      });
    };

    const failPurchase = async (statusCode, reason, message, details = {}) => {
      await logPurchaseResult('fail', reason, details);
      return res.status(statusCode).json({ error: message });
    };

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

    await logSecurityEvent({
      wallet: walletLower,
      eventType: 'purchase_attempt',
      route: req.path,
      ipAddress: req.ip,
      details: purchaseDetails
    });

    
    const config = UPGRADES_CONFIG[resolvedUpgradeKey];
    if (!config) {
      return failPurchase(400, 'unknown_upgrade', `Unknown upgrade: ${requestedUpgradeKey}`);
    }

    // Timestamp validation
    const timestampValidation = validateTimestampWindow(timestamp, { windowMs: 10 * 60 * 1000 });

    if (!timestampValidation.valid) {
      if (timestampValidation.error === 'Invalid timestamp format') {
        return failPurchase(400, 'invalid_timestamp_format', timestampValidation.error);
      }

      return failPurchase(400, 'timestamp_out_of_range', timestampValidation.error, {
        timeDiff: timestampValidation.timeDiff
      });
    }

    const { normalizedTs: ts } = timestampValidation;

    if (isTelegramAuth) {
      // Verify that the telegramId matches the claimed primaryId (wallet) via AccountLink
      const link = await AccountLink.findOne({ telegramId: String(telegramId) });
      if (!link || link.primaryId !== walletLower) {
        return failPurchase(401, 'telegram_verification_failed', 'Telegram identity verification failed');
      }
    } else {
      // Signature verification
      const message = `Buy upgrade\nWallet: ${walletLower}\nUpgrade: ${requestedUpgradeKey}\nTier: ${tier !== undefined ? tier : 0}\nTimestamp: ${ts}`;
      const isValid = verifySignature(message, signature, walletLower);

      if (!isValid) {
        return failPurchase(401, 'invalid_signature', 'Invalid signature');
      }
    }

    // Player data
    const player = await Player.findOne({ wallet: walletLower });
    if (!player) {
      return failPurchase(404, 'player_not_found', 'Player not found. Play at least one game first.');
    }

    let upgrades = await PlayerUpgrades.findOne({ wallet: walletLower });
    if (!upgrades) {
      upgrades = new PlayerUpgrades({ wallet: walletLower });
    }

    // Refresh free rides + normalize legacy shield progression
    upgrades.refreshFreeRides();
    normalizeShieldUpgrades(upgrades);

    // === PURCHASE LOGIC BY TYPE ===

    if (config.type === "tiered") {
      const currentLevel = upgrades[resolvedUpgradeKey] || 0;

      if (tier !== currentLevel) {
        return failPurchase(400, 'tier_mismatch', `Must buy tier ${currentLevel}. Current: ${currentLevel}, requested: ${tier}`, {
          currentLevel
        });
      }

      if (currentLevel >= config.maxLevel) {
        return failPurchase(400, 'max_level_reached', 'Already at max level');
      }

      const price = config.prices[tier];

      if (config.currency === "silver") {
        if (player.totalSilverCoins < price) {
          return failPurchase(400, 'insufficient_silver', `Not enough silver. Need: ${price}, have: ${player.totalSilverCoins}`, {
            required: price,
            available: player.totalSilverCoins
          });
        }
        player.totalSilverCoins -= price;
      } else {
        if (player.totalGoldCoins < price) {
          return failPurchase(400, 'insufficient_gold', `Not enough gold. Need: ${price}, have: ${player.totalGoldCoins}`, {
            required: price,
            available: player.totalGoldCoins
          });
        }
        player.totalGoldCoins -= price;
      }

      upgrades[resolvedUpgradeKey] = currentLevel + 1;
      logger.info({ wallet: walletLower, upgradeKey: resolvedUpgradeKey, tier: currentLevel + 1, maxLevel: config.maxLevel, price, currency: config.currency }, 'Upgrade purchased');

    } else if (config.type === "permanent") {
      const currentLevel = upgrades[resolvedUpgradeKey] || 0;

      if (tier !== currentLevel) {
        return failPurchase(400, 'tier_mismatch', `Must buy tier ${currentLevel}. Current: ${currentLevel}, requested: ${tier}`, {
          currentLevel
        });
      }

      if (currentLevel >= config.maxLevel) {
        return failPurchase(400, 'max_level_reached', 'Already at max level');
      }

      const price = config.prices[currentLevel];

      if (config.currency === "gold") {
        if (player.totalGoldCoins < price) {
          return failPurchase(400, 'insufficient_gold', `Not enough gold. Need: ${price}, have: ${player.totalGoldCoins}`, {
            required: price,
            available: player.totalGoldCoins
          });
        }
        player.totalGoldCoins -= price;
      } else {
        if (player.totalSilverCoins < price) {
          return failPurchase(400, 'insufficient_silver', `Not enough silver. Need: ${price}, have: ${player.totalSilverCoins}`, {
            required: price,
            available: player.totalSilverCoins
          });
        }
        player.totalSilverCoins -= price;
      }

      upgrades[resolvedUpgradeKey] = currentLevel + 1;
      logger.info({ wallet: walletLower, upgradeKey: resolvedUpgradeKey, tier: currentLevel + 1, maxLevel: config.maxLevel, price, currency: config.currency }, 'Upgrade purchased');

    } else if (config.type === "rides") {
      const price = config.price;

      if (player.totalGoldCoins < price) {
        return failPurchase(400, 'insufficient_gold', `Not enough gold. Need: ${price}, have: ${player.totalGoldCoins}`, {
          required: price,
          available: player.totalGoldCoins
        });
      }

      player.totalGoldCoins -= price;
      upgrades.paidRidesRemaining += config.amount;

      logger.info({ wallet: walletLower, ridesBought: config.amount, price, currency: 'gold', paidRidesRemaining: upgrades.paidRidesRemaining }, 'Rides purchased');

    } else {
      return failPurchase(400, 'unknown_upgrade_type', 'Unknown upgrade type');
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

    await logPurchaseResult('success', 'completed');

    logger.info({ wallet: walletLower, requestedUpgradeKey, resolvedUpgradeKey, tier: tier ?? 0 }, 'Purchase processed');


    res.json({
      success: true,
      message: `Purchased ${resolvedUpgradeKey}`,
      requestedUpgradeKey,
      resolvedUpgradeKey,
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
    const walletLower = typeof req.body?.wallet === 'string' ? req.body.wallet.toLowerCase() : null;
    if (walletLower) {
      await logSecurityEvent({
        wallet: walletLower,
        eventType: 'purchase_result',
        route: req.path,
        ipAddress: req.ip,
        details: {
          requestedUpgradeKey: String(req.body?.upgradeKey || '').trim(),
          resolvedUpgradeKey: resolveUpgradeKey(String(req.body?.upgradeKey || '').trim()),
          tier: req.body?.tier ?? 0,
          authMode: req.body?.authMode || 'wallet',
          status: 'fail',
          reason: 'server_error',
          error: error.message
        }
      });
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
    const { wallet, rideSessionId } = req.body;
    if (!wallet) return res.status(400).json({ error: 'Missing wallet' });

    const walletLower = normalizeWallet(wallet);
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

    // Refresh free rides + normalize legacy shield progression
    upgrades.refreshFreeRides();
    normalizeShieldUpgrades(upgrades);
    
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

    logger.info({ wallet: walletLower, freeRidesRemaining: upgrades.freeRidesRemaining, paidRidesRemaining: upgrades.paidRidesRemaining }, 'Ride consumed');
    

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
    const wallet = normalizeWallet(req.params.wallet);

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
