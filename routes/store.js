const express = require('express');
const router = express.Router();
const Player = require('../models/Player');
const PlayerUpgrades = require('../models/PlayerUpgrades');
const AccountLink = require('../models/AccountLink');
const { UPGRADES_CONFIG, calculateEffects } = require('../utils/upgradesConfig');
const { listDonationProducts, listDonationPayments, createDonationPayment, submitDonationTransaction, getDonationPayment, serializeDonationPayment } = require('../utils/donationService');
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

function isLevelUpgradeType(type) {
  return type === 'tiered' || type === 'permanent';
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

async function getOrCreatePlayerUpgrades(wallet) {
  let upgrades = await PlayerUpgrades.findOne({ wallet });
  if (!upgrades) {
    upgrades = new PlayerUpgrades({ wallet });
    await upgrades.save();
  }
  return upgrades;
}

async function prepareUpgrades(upgrades, { persist = false } = {}) {
  const ridesChanged = upgrades.refreshFreeRides();
  const shieldChanged = normalizeShieldUpgrades(upgrades);

  if (persist && (ridesChanged || shieldChanged)) {
    await upgrades.save();
  }

  return upgrades;
}

function buildRidesData(upgrades, options = {}) {
  const now = new Date();
  const resetAt = upgrades.freeRidesResetAt || now;
  const msUntilReset = Math.max(0, (8 * 60 * 60 * 1000) - (now - resetAt));
  const resetInMs = options.resetInMs ?? (upgrades.freeRidesRemaining < 3 ? msUntilReset : 0);

  return {
    freeRides: options.freeRides ?? upgrades.freeRidesRemaining,
    paidRides: options.paidRides ?? upgrades.paidRidesRemaining,
    totalRides: options.totalRides ?? upgrades.getTotalRides(),
    maxFreeRides: 3,
    resetInMs,
    resetInFormatted: options.resetInFormatted ?? formatTimeLeft(resetInMs)
  };
}

async function spendPlayerCurrency(player, currency, amount, failPurchase) {
  const balanceField = currency === 'silver' ? 'totalSilverCoins' : 'totalGoldCoins';
  const label = currency === 'silver' ? 'silver' : 'gold';
  const available = player[balanceField];

  if (available < amount) {
    return failPurchase(
      400,
      `insufficient_${label}`,
      `Not enough ${label}. Need: ${amount}, have: ${available}`,
      { required: amount, available }
    );
  }

  player[balanceField] -= amount;
  return null;
}

async function applyLevelUpgrade({
  upgrades,
  upgradeKey,
  nextLevel,
  maxLevel,
  price,
  currency,
  wallet,
  player,
  failPurchase
}) {
  const insufficientFundsResponse = await spendPlayerCurrency(player, currency, price, failPurchase);
  if (insufficientFundsResponse) {
    return insufficientFundsResponse;
  }

  upgrades[upgradeKey] = nextLevel;
  logger.info({ wallet, upgradeKey, tier: nextLevel, maxLevel, price, currency }, 'Upgrade purchased');
  return null;
}

async function validateLevelPurchase({ tier, currentLevel, maxLevel, failPurchase }) {
  if (tier !== currentLevel) {
    return failPurchase(
      400,
      'tier_mismatch',
      `Must buy tier ${currentLevel}. Current: ${currentLevel}, requested: ${tier}`,
      { currentLevel }
    );
  }

  if (currentLevel >= maxLevel) {
    return failPurchase(400, 'max_level_reached', 'Already at max level');
  }

  return null;
}

function createPurchaseAudit({ wallet, req, res, purchaseDetails }) {
  const logPurchaseResult = async (status, reason, details = {}) => {
    await logSecurityEvent({
      wallet,
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

  const logPurchaseAttempt = async () => {
    const recentBuyCount = await SecurityEvent.countDocuments({
      wallet,
      eventType: 'purchase_attempt',
      createdAt: { $gte: new Date(Date.now() - 2 * 60 * 1000) }
    });

    if (recentBuyCount >= 12) {
      markSuspicious('rapid_purchases');
      await logSecurityEvent({
        wallet,
        eventType: 'suspicious_rapid_purchases',
        route: req.path,
        ipAddress: req.ip,
        details: { recentBuyCount }
      });
      logger.warn({ wallet, recentBuyCount }, 'Suspicious rapid purchase pattern');
    }

    await logSecurityEvent({
      wallet,
      eventType: 'purchase_attempt',
      route: req.path,
      ipAddress: req.ip,
      details: purchaseDetails
    });
  };

  const logServerError = async (requestBody, error) => {
    if (!wallet) {
      return;
    }

    await logSecurityEvent({
      wallet,
      eventType: 'purchase_result',
      route: req.path,
      ipAddress: req.ip,
      details: {
        requestedUpgradeKey: String(requestBody?.upgradeKey || '').trim(),
        resolvedUpgradeKey: resolveUpgradeKey(String(requestBody?.upgradeKey || '').trim()),
        tier: requestBody?.tier ?? 0,
        authMode: requestBody?.authMode || 'wallet',
        status: 'fail',
        reason: 'server_error',
        error: error.message
      }
    });
  };

  return {
    failPurchase,
    logPurchaseResult,
    logPurchaseAttempt,
    logServerError
  };
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

    const upgrades = await getOrCreatePlayerUpgrades(wallet);
    await prepareUpgrades(upgrades, { persist: true });

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

    res.json({
      wallet,
      balance: { gold, silver },
      upgrades: upgradesData,
      rides: buildRidesData(upgrades),
      activeEffects: effects
    });

  } catch (error) {
    logger.error({ err: error }, 'GET /upgrades error');
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/store/donations/history/:wallet
 * Get donation payment history for a wallet
 */
router.get('/donations/history/:wallet', readLimiter, async (req, res) => {
  try {
    const payload = await listDonationPayments(req.params.wallet, { limit: req.query.limit });
    res.json(payload);
  } catch (error) {
    logger.error({ err: error }, 'GET /donations/history error');
    res.status(error.statusCode || 500).json({ error: error.message || 'Server error' });
  }
});

/**
 * GET /api/store/donations/:wallet
 * Get all USDT donation products for a wallet
 */
router.get('/donations/:wallet', readLimiter, async (req, res) => {
  try {
    const wallet = normalizeWallet(req.params.wallet);

    if (!wallet || wallet.length < 3) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    const payload = await listDonationProducts(wallet);
    res.json(payload);
  } catch (error) {
    logger.error({ err: error }, 'GET /donations error');
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/store/donations/create-payment
 */
router.post('/donations/create-payment', writeLimiter, async (req, res) => {
  try {
    const { wallet, productKey, donationKey, key, productId } = req.body;
    const resolvedProductKey = productKey || donationKey || key || productId;
    const payment = await createDonationPayment(wallet, resolvedProductKey);

    await logSecurityEvent({
      wallet: payment.wallet,
      eventType: 'donation_payment_created',
      route: req.path,
      ipAddress: req.ip,
      details: {
        paymentId: payment.paymentId,
        productKey: payment.productKey,
        amount: payment.expectedAmount
      }
    });

    res.status(201).json(serializeDonationPayment(payment));
  } catch (error) {
    logger.error({ err: error }, 'POST /donations/create-payment error');
    res.status(error.statusCode || 500).json({ error: error.message || 'Server error' });
  }
});

/**
 * POST /api/store/donations/submit-transaction
 */
router.post('/donations/submit-transaction', writeLimiter, async (req, res) => {
  try {
    const { wallet, paymentId, txHash } = req.body;
    const payment = await submitDonationTransaction({ wallet, paymentId, txHash });

    await logSecurityEvent({
      wallet: payment.wallet,
      eventType: 'donation_tx_submitted',
      route: req.path,
      ipAddress: req.ip,
      details: {
        paymentId: payment.paymentId,
        productKey: payment.productKey,
        txHash: payment.txHash,
        status: payment.status
      }
    });

    res.json(serializeDonationPayment(payment));
  } catch (error) {
    logger.error({ err: error }, 'POST /donations/submit-transaction error');
    res.status(error.statusCode || 500).json({ error: error.message || 'Server error' });
  }
});

/**
 * GET /api/store/donations/payment/:paymentId
 */
router.get('/donations/payment/:paymentId', readLimiter, async (req, res) => {
  try {
    const { wallet, txHash } = req.query;
    const payment = await getDonationPayment(req.params.paymentId, { wallet, txHash });
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    res.json(serializeDonationPayment(payment));
  } catch (error) {
    logger.error({ err: error }, 'GET /donations/payment error');
    res.status(error.statusCode || 500).json({ error: error.message || 'Server error' });
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
    const {
      failPurchase,
      logPurchaseResult,
      logPurchaseAttempt,
      logServerError
    } = createPurchaseAudit({
      wallet: walletLower,
      req,
      res,
      purchaseDetails
    });

    await logPurchaseAttempt();

    
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

    const upgrades = await getOrCreatePlayerUpgrades(walletLower);
    await prepareUpgrades(upgrades);

    // === PURCHASE LOGIC BY TYPE ===

    if (isLevelUpgradeType(config.type)) {
      const currentLevel = upgrades[resolvedUpgradeKey] || 0;
      const validationFailure = await validateLevelPurchase({
        tier,
        currentLevel,
        maxLevel: config.maxLevel,
        failPurchase
      });
      if (validationFailure) {
        return validationFailure;
      }

      const priceIndex = config.type === 'tiered' ? tier : currentLevel;
      const price = config.prices[priceIndex];
      const failure = await applyLevelUpgrade({
        upgrades,
        upgradeKey: resolvedUpgradeKey,
        nextLevel: currentLevel + 1,
        maxLevel: config.maxLevel,
        price,
        currency: config.currency,
        wallet: walletLower,
        player,
        failPurchase
      });
      if (failure) {
        return failure;
      }

    } else if (config.type === "rides") {
      const price = config.price;
      const failure = await spendPlayerCurrency(player, 'gold', price, failPurchase);
      if (failure) {
        return failure;
      }
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
      rides: buildRidesData(upgrades),
      activeEffects: effects
    });

  } catch (error) {
    const walletLower = typeof req.body?.wallet === 'string' ? req.body.wallet.toLowerCase() : null;
    const purchaseAudit = createPurchaseAudit({
      wallet: walletLower,
      req,
      res,
      purchaseDetails: {
        requestedUpgradeKey: String(req.body?.upgradeKey || '').trim(),
        resolvedUpgradeKey: resolveUpgradeKey(String(req.body?.upgradeKey || '').trim()),
        tier: req.body?.tier ?? 0,
        authMode: req.body?.authMode || 'wallet'
      }
    });
    await purchaseAudit.logServerError(req.body, error);
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
    const upgrades = await getOrCreatePlayerUpgrades(walletLower);
    await prepareUpgrades(upgrades);
    
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
        rides: buildRidesData(upgrades)
      });
    }

    const totalBefore = upgrades.getTotalRides();

    if (totalBefore <= 0) {
      const resetAt = upgrades.freeRidesResetAt || new Date();
      const msUntilReset = Math.max(0, (8 * 60 * 60 * 1000) - (new Date() - resetAt));

      return res.status(403).json({
        error: 'No rides remaining',
        rides: buildRidesData(upgrades, {
          freeRides: 0,
          paidRides: 0,
          totalRides: 0,
          resetInMs: msUntilReset,
          resetInFormatted: formatTimeLeft(msUntilReset)
        })
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

    logger.info({ wallet: walletLower, freeRidesRemaining: upgrades.freeRidesRemaining, paidRidesRemaining: upgrades.paidRidesRemaining }, 'Ride consumed');
    

    const antiCheat = sessionId
      ? { duplicateSessionCheck: true, rideSessionId: sessionId }
      : { duplicateSessionCheck: false, warning: 'Legacy /use-ride call without rideSessionId. Please migrate to /consume-ride with rideSessionId.' };

    res.json({
      success: true,
      antiCheat,
      rides: buildRidesData(upgrades)
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

    const upgrades = await getOrCreatePlayerUpgrades(wallet);
    await prepareUpgrades(upgrades, { persist: true });

    res.json({
      ...buildRidesData(upgrades)
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
