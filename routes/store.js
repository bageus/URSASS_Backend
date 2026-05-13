const express = require('express');
const router = express.Router();
const Player = require('../models/Player');
const PlayerUpgrades = require('../models/PlayerUpgrades');
const AccountLink = require('../models/AccountLink');
const { UPGRADES_CONFIG, calculateEffects } = require('../utils/upgradesConfig');
const { listDonationProducts, listDonationPayments, createDonationPayment, submitDonationTransaction, getDonationPayment, serializeDonationPayment } = require('../utils/donationService');
const { verifySignature } = require('../utils/verifySignature');
const { validateTelegramInitData } = require('../utils/telegramAuth');
const { writeLimiter, readLimiter } = require('../middleware/rateLimiter');
const SecurityEvent = require('../models/SecurityEvent');
const CoinTransaction = require('../models/CoinTransaction');
const logger = require('../utils/logger');
const { markSuspicious } = require('../middleware/requestMetrics');
const { logSecurityEvent, normalizeWallet, parseWalletOrNull, buildInvalidWalletError, validateTimestampWindow } = require('../utils/security');
const { hasAiModeAccess, hasAiModeAccessByTelegramUsername } = require('../utils/aiModeAccess');
const { getOrCreateOnboardingState, setOnboardingEvent } = require('../services/onboardingService');

const UPGRADE_KEY_ALIASES = {
  spin_alert: 'alert',
  start_with_alert: 'alert',
  start_with_radar: 'radar_gold',
  radar: 'radar_gold',
  spin_perfect: 'alert'
};

const NEW_PLAYER_GOLD_UPGRADE_DEFAULTS = {
  shield: 0,
  shield_capacity: 0,
  radar_obstacles: 0,
  radar_gold: 0,
  alert: 0
};

function toUpgradeLevel(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === 'false' || normalized === 'null' || normalized === 'undefined') {
      return 0;
    }
    if (normalized === 'true') {
      return 1;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isNormalizedUpgradeLevel(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function resolveUpgradeKey(upgradeKey) {
  return UPGRADE_KEY_ALIASES[upgradeKey] || upgradeKey;
}

function isLevelUpgradeType(type) {
  return type === 'tiered' || type === 'permanent';
}

function normalizeShieldUpgrades(upgrades) {
  let changed = false;
  const legacyShieldLevel = toUpgradeLevel(upgrades.shield);
  const currentCapacityLevel = toUpgradeLevel(upgrades.shield_capacity);

  if (legacyShieldLevel > 1) {
    const migratedCapacityLevel = Math.min(2, legacyShieldLevel - 1);

    if (currentCapacityLevel < migratedCapacityLevel) {
      upgrades.shield_capacity = migratedCapacityLevel;
      changed = true;
    }

    upgrades.shield = 1;
    changed = true;
  } else {
    if (!isNormalizedUpgradeLevel(upgrades.shield) || upgrades.shield !== legacyShieldLevel) {
      upgrades.shield = legacyShieldLevel;
      changed = true;
    }
    if (!isNormalizedUpgradeLevel(upgrades.shield_capacity) || upgrades.shield_capacity !== currentCapacityLevel) {
      upgrades.shield_capacity = currentCapacityLevel;
      changed = true;
    }
  }

  if (typeof upgrades.shield_capacity !== 'number') {
    upgrades.shield_capacity = 0;
    changed = true;
  }

  return changed;
}

function normalizeRadarUpgrades(upgrades) {
  const legacyRadarLevel = toUpgradeLevel(upgrades.radar);
  const currentRadarGoldLevel = toUpgradeLevel(upgrades.radar_gold);
  let changed = false;

  if (legacyRadarLevel > 0 && currentRadarGoldLevel < 1) {
    upgrades.radar_gold = 1;
    changed = true;
  } else if (!isNormalizedUpgradeLevel(upgrades.radar_gold) || upgrades.radar_gold !== currentRadarGoldLevel) {
    upgrades.radar_gold = currentRadarGoldLevel;
    changed = true;
  }

  const radarObstaclesLevel = toUpgradeLevel(upgrades.radar_obstacles);
  if (!isNormalizedUpgradeLevel(upgrades.radar_obstacles) || upgrades.radar_obstacles !== radarObstaclesLevel) {
    upgrades.radar_obstacles = radarObstaclesLevel;
    changed = true;
  }

  return changed;
}

function normalizeAlertUpgrade(upgrades) {
  const alertLevel = toUpgradeLevel(upgrades.alert);
  if (!isNormalizedUpgradeLevel(upgrades.alert) || upgrades.alert !== alertLevel) {
    upgrades.alert = alertLevel;
    return true;
  }
  return false;
}


function normalizeTelegramUsername(username) {
  return String(username || '').trim().toLowerCase().replace(/^@/, '');
}

function parseTelegramInitDataIdentity(initDataRaw) {
  if (!initDataRaw || typeof initDataRaw !== 'string') {
    return { telegramId: '', telegramUsername: '' };
  }

  try {
    const params = new URLSearchParams(initDataRaw);
    const userRaw = params.get('user');
    if (!userRaw) {
      return { telegramId: '', telegramUsername: '' };
    }

    const user = JSON.parse(userRaw);
    return {
      telegramId: String(user?.id || '').trim(),
      telegramUsername: String(user?.username || '').trim()
    };
  } catch (error) {
    return { telegramId: '', telegramUsername: '' };
  }
}

async function getOrCreatePlayerUpgrades(wallet) {
  let upgrades = await PlayerUpgrades.findOne({ wallet });
  if (!upgrades) {
    upgrades = new PlayerUpgrades({ wallet, ...NEW_PLAYER_GOLD_UPGRADE_DEFAULTS });
    await upgrades.save();
  }
  return upgrades;
}

async function resolvePrimaryIdFromIdentifier(identifier) {
  const normalized = String(identifier || '').trim().toLowerCase();
  const normalizedTelegramUsername = normalizeTelegramUsername(normalized);
  if (!normalized) return null;
  if (parseWalletOrNull(normalized)) {
    return normalized;
  }
  const link = await AccountLink.findOne({
    $or: [
      { primaryId: normalized },
      { wallet: normalized },
      { telegramId: normalized },
      { telegramUsername: normalizedTelegramUsername },
      { telegramUsername: `@${normalizedTelegramUsername}` }
    ]
  });
  return link?.primaryId || null;
}

async function resolveStorePrimaryId(req) {
  const paramWallet = String(req.params.wallet || '').trim().toLowerCase();
  const headerPrimaryId = String(req.get('X-Primary-Id') || '').trim().toLowerCase();
  const reqPrimaryId = String(req.primaryId || '').trim().toLowerCase();
  const telegramInitData = req.get('X-Telegram-Init-Data');
  const { telegramId, telegramUsername } = parseTelegramInitDataIdentity(telegramInitData);
  const normalizedTelegramUsername = normalizeTelegramUsername(telegramUsername);

  const identifiers = [
    paramWallet,
    headerPrimaryId,
    reqPrimaryId,
    telegramId,
    normalizedTelegramUsername
  ].filter(Boolean);

  for (const identifier of identifiers) {
    const resolvedPrimaryId = await resolvePrimaryIdFromIdentifier(identifier);
    if (resolvedPrimaryId) {
      const accountLink = await AccountLink.findOne({ primaryId: resolvedPrimaryId });
      return {
        primaryId: resolvedPrimaryId,
        identifier,
        telegramId,
        telegramUsername,
        normalizedTelegramUsername,
        accountLink
      };
    }
  }

  if (telegramId) {
    const tgLink = await AccountLink.findOne({ telegramId });
    if (tgLink?.primaryId) {
      return {
        primaryId: tgLink.primaryId,
        identifier: telegramId,
        telegramId,
        telegramUsername,
        normalizedTelegramUsername,
        accountLink: tgLink
      };
    }
  }

  return null;
}

async function prepareUpgrades(upgrades, { persist = false } = {}) {
  const ridesChanged = upgrades.refreshFreeRides();
  const shieldChanged = normalizeShieldUpgrades(upgrades);
  const radarChanged = normalizeRadarUpgrades(upgrades);
  const alertChanged = normalizeAlertUpgrade(upgrades);

  if (persist && (ridesChanged || shieldChanged || radarChanged || alertChanged)) {
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
    const resolvedIdentity = await resolveStorePrimaryId(req);
    if (!resolvedIdentity?.primaryId) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const wallet = resolvedIdentity.primaryId;
    const {
      identifier,
      telegramId,
      telegramUsername,
      normalizedTelegramUsername,
      accountLink
    } = resolvedIdentity;

    const upgrades = await getOrCreatePlayerUpgrades(wallet);
    await prepareUpgrades(upgrades, { persist: true });

    const player = await Player.findOne({ wallet });
    const gold = player ? player.totalGoldCoins : 0;
    const silver = player ? player.totalSilverCoins : 0;

    const effects = calculateEffects(upgrades);
    const aiByWallet = hasAiModeAccess(wallet);
    const aiByTelegramUsername = hasAiModeAccessByTelegramUsername(accountLink?.telegramUsername)
      || hasAiModeAccessByTelegramUsername(telegramUsername);
    const aiModeAccess = aiByWallet || aiByTelegramUsername;
    effects.ai_mode_access = aiModeAccess;

    logger.debug({
      identifier,
      resolvedWallet: wallet,
      telegramId,
      telegramUsername,
      normalizedTelegramUsername,
      aiByWallet,
      aiByTelegramUsername,
      aiModeAccess
    }, 'AI mode access resolution');

    // Build upgrades data
    const upgradesData = {};
    for (const key in UPGRADES_CONFIG) {
      const config = UPGRADES_CONFIG[key];

      if (config.type === "tiered" || config.type === "permanent") {
        const currentLevel = Math.max(0, toUpgradeLevel(upgrades[key]));
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
    if (upgradesData.radar_gold && !upgradesData.start_with_radar) {
      upgradesData.start_with_radar = { ...upgradesData.radar_gold };
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
    const wallet = await resolvePrimaryIdFromIdentifier(req.params.wallet);

    const payload = await listDonationProducts(wallet);
    res.json(payload);
  } catch (error) {
    logger.error({ err: error }, 'GET /donations error');
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/store/donations
 * Public donation products catalog (no auth/wallet required)
 */
router.get('/donations', readLimiter, async (req, res) => {
  try {
    const payload = await listDonationProducts(null);
    res.json(payload);
  } catch (error) {
    logger.error({ err: error }, 'GET /donations (public) error');
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/store/donations/create-payment
 */
router.post('/donations/create-payment', writeLimiter, async (req, res) => {
  let wallet;
  let productKey;
  let donationKey;
  let key;
  let productId;
  try {
    ({ wallet, productKey, donationKey, key, productId } = req.body || {});
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
    logger.error({ err: error, wallet, productKey, donationKey, key, productId, requestId: req.requestId }, 'POST /donations/create-payment error');
    res.status(error.statusCode || 500).json({ error: error.message || 'Server error', requestId: req.requestId });
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
  let purchaseApplied = false;
  let responsePayload = null;
  try {
    const { wallet, primaryId, upgradeKey, tier, signature, timestamp, authMode, telegramId, telegramInitData } = req.body;
    const idempotencyKey = String(
      req.get('x-idempotency-key') || req.get('x-request-id') || req.body?.requestId || req.requestId || ''
    ).trim();
    const requestedUpgradeKey = String(upgradeKey || '').trim();
    const resolvedUpgradeKey = resolveUpgradeKey(requestedUpgradeKey);

    const isTelegramAuth = authMode === 'telegram';

    if (isTelegramAuth) {
      if ((!primaryId && !telegramId) || !requestedUpgradeKey || !timestamp) {
        return res.status(400).json({
          error: 'Missing Telegram identity'
        });
      }
    } else {
      if (!wallet || !requestedUpgradeKey || !signature || !timestamp) {
        return res.status(400).json({
          error: 'Missing fields: wallet, upgradeKey, signature, timestamp'
        });
      }
    }

    let accountKey = null;
    if (!isTelegramAuth) {
      accountKey = parseWalletOrNull(wallet);
      if (!accountKey) {
        return res.status(400).json(buildInvalidWalletError('Invalid wallet address'));
      }
    }
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
      wallet: accountKey,
      req,
      res,
      purchaseDetails
    });

    await logPurchaseAttempt();

    if (idempotencyKey) {
      const existingSuccess = await SecurityEvent.findOne({
        wallet: accountKey,
        eventType: 'purchase_result',
        'details.status': 'success',
        'details.requestId': idempotencyKey
      })
        .sort({ createdAt: -1 })
        .lean();

      if (existingSuccess) {
        const upgrades = await getOrCreatePlayerUpgrades(accountKey);
        await prepareUpgrades(upgrades, { persist: true });
        const player = await Player.findOne({ wallet: accountKey });
        return res.json({
          success: true,
          duplicate: true,
          message: `Purchased ${resolvedUpgradeKey}`,
          requestedUpgradeKey,
          resolvedUpgradeKey,
          balance: {
            gold: player?.totalGoldCoins || 0,
            silver: player?.totalSilverCoins || 0
          },
          rides: buildRidesData(upgrades),
          activeEffects: calculateEffects(upgrades)
        });
      }
    }

    
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
      const tgId = String(telegramId || '').trim();
      const providedPrimaryId = String(primaryId || '').trim().toLowerCase();

      const validation = validateTelegramInitData(telegramInitData, process.env.TELEGRAM_BOT_TOKEN);
      if (!validation.valid || !validation.user?.id) {
        return failPurchase(401, 'telegram_verification_failed', 'Telegram identity verification failed');
      }

      const verifiedTelegramId = String(validation.user.id);
      if (tgId && tgId !== verifiedTelegramId) {
        return failPurchase(401, 'telegram_verification_failed', 'Telegram identity verification failed');
      }

      const link = await AccountLink.findOne({ telegramId: verifiedTelegramId });
      if (!link) {
        return failPurchase(401, 'telegram_verification_failed', 'Telegram identity verification failed');
      }
      if (providedPrimaryId && link.primaryId !== providedPrimaryId) {
        return failPurchase(401, 'telegram_verification_failed', 'Telegram identity verification failed');
      }

      accountKey = link.wallet || link.primaryId || `tg_${verifiedTelegramId}`;
    } else {
      // Signature verification
      const message = `Buy upgrade\nWallet: ${accountKey}\nUpgrade: ${requestedUpgradeKey}\nTier: ${tier !== undefined ? tier : 0}\nTimestamp: ${ts}`;
      const isValid = verifySignature(message, signature, accountKey);

      if (!isValid) {
        return failPurchase(401, 'invalid_signature', 'Invalid signature');
      }
    }

    // Player data
    const player = await Player.findOne({ wallet: accountKey });
    if (!player) {
      return failPurchase(404, 'player_not_found', 'Player not found');
    }

    const upgrades = await getOrCreatePlayerUpgrades(accountKey);
    await prepareUpgrades(upgrades);

    const purchaseSnapshotBefore = {
      gold: player.totalGoldCoins,
      silver: player.totalSilverCoins,
      paidRidesRemaining: upgrades.paidRidesRemaining,
      upgradeLevel: upgrades[resolvedUpgradeKey] || 0
    };

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
        wallet: accountKey,
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

      logger.info({ wallet: accountKey, ridesBought: config.amount, price, currency: 'gold', paidRidesRemaining: upgrades.paidRidesRemaining }, 'Rides purchased');

    } else {
      return failPurchase(400, 'unknown_upgrade_type', 'Unknown upgrade type');
    }

    // Save
    upgrades.updatedAt = new Date();
    player.updatedAt = new Date();

    await upgrades.save();
    await player.save();
    purchaseApplied = true;

    const effects = calculateEffects(upgrades);

    await logPurchaseResult('success', 'completed', { requestId: idempotencyKey || null });

    logger.info({ wallet: accountKey, requestedUpgradeKey, resolvedUpgradeKey, tier: tier ?? 0 }, 'Purchase processed');


    responsePayload = {
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
    };

    try {
      await CoinTransaction.create({
        primaryId: accountKey,
        type: 'buy',
        contextKey: idempotencyKey ? `buy:${accountKey}:${idempotencyKey}` : null,
        gold: currencyForPurchase(config) === 'gold' ? purchasePrice(config, tier, purchaseSnapshotBefore) : 0,
        silver: currencyForPurchase(config) === 'silver' ? purchasePrice(config, tier, purchaseSnapshotBefore) : 0
      });
    } catch (err) {
      logger.error({ err, wallet: accountKey, productKey: resolvedUpgradeKey, currency: currencyForPurchase(config), price: purchasePrice(config, tier, purchaseSnapshotBefore) }, 'CoinTransaction side effect failed');
    }

    if (config.type === 'rides') {
      try {
        const onboardingState = await getOrCreateOnboardingState(accountKey);
        onboardingState.storeIntro = onboardingState.storeIntro || {};
        onboardingState.storeIntro.ridePackBought = true;
        onboardingState.mainFlowCompleted = true;
        setOnboardingEvent(onboardingState, { key: 'store_in', action: 'complete', screen: 'store' });
        await onboardingState.save();
      } catch (err) {
        logger.error({ err, wallet: accountKey, productKey: resolvedUpgradeKey }, 'Onboarding side effect failed');
      }
    }

    res.json(responsePayload);

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
    logger.error({ err: error, wallet: req.body?.wallet, productKey: req.body?.upgradeKey, currency: null, price: null }, 'POST /buy error');
    if (purchaseApplied && responsePayload) {
      return res.json(responsePayload);
    }
    res.status(500).json({ error: 'Server error' });
  }
});

function currencyForPurchase(config) {
  if (config.type === 'rides') return 'gold';
  return config.currency;
}

function purchasePrice(config, tier, beforeSnapshot) {
  if (config.type === 'rides') return config.price;
  const beforeLevel = beforeSnapshot.upgradeLevel || 0;
  const index = config.type === 'tiered' ? tier : beforeLevel;
  return config.prices[index] || 0;
}

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
