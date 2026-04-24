const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const mongoose = require('mongoose');
const Player = require('../models/Player');
const GameResult = require('../models/GameResult');
const AccountLink = require('../models/AccountLink');
const PlayerRun = require('../models/PlayerRun');
const { verifySignature, createMessageToVerify } = require('../utils/verifySignature');
const { saveResultLimiter, readLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');
const { markSuspicious } = require('../middleware/requestMetrics');
const { logSecurityEvent, normalizeWallet, validateTimestampWindow } = require('../utils/security');
const { hasAiModeAccess, validateAiSettings } = require('../utils/aiModeAccess');
const { computePlayerInsights, DEFAULTS: leaderboardInsightsConfig } = require('../services/leaderboardInsightsService');

/**
 * Build display name for a player based on their AccountLink data.
 * Priority:
 *   1. If wallet is linked → show wallet address (shortened)
 *   2. If only telegram → show "TG#id"
 *   3. Fallback → show primaryId (shortened if wallet-like)
 */
function buildDisplayName(link, primaryId) {
  if (!link) {
    if (primaryId && primaryId.startsWith('0x')) {
      return `${primaryId.slice(0, 6)}...${primaryId.slice(-4)}`;
    }
    return primaryId || 'Unknown';
  }

  // If wallet is linked — show wallet
  if (link.wallet) {
    return `${link.wallet.slice(0, 6)}...${link.wallet.slice(-4)}`;
  }

  // Only telegram — show @username first, then TG#id
  if (link.telegramUsername) {
    return `@${link.telegramUsername}`;
  }

  if (link.telegramId) {
    return `TG#${link.telegramId}`;
  }

  if (primaryId && primaryId.startsWith('0x')) {
    return `${primaryId.slice(0, 6)}...${primaryId.slice(-4)}`;
  }
  return primaryId || 'Unknown';
}

function buildLeaderboardEntry(player, displayName, position) {
  return {
    position,
    wallet: player.wallet,
    displayName,
    bestScore: player.bestScore,
    averageScore: player.averageScore || 0,
    scoreToAverageRatio: player.scoreToAverageRatio || null,
    bestDistance: player.bestDistance,
    totalGoldCoins: player.totalGoldCoins,
    totalSilverCoins: player.totalSilverCoins,
    gamesPlayed: player.gamesPlayed
  };
}

function isValidWalletAddress(wallet) {
  return /^0x[a-fA-F0-9]{40}$/.test(wallet);
}

// ✅ GET: Top 10 players
router.get('/top', readLimiter, async (req, res) => {
  try {
    const walletQuery = typeof req.query.wallet === 'string' ? req.query.wallet.trim() : '';
    const wallet = walletQuery ? walletQuery.toLowerCase() : null;

    if (wallet && !isValidWalletAddress(wallet)) {
      logger.warn({ wallet: walletQuery, requestId: req.requestId }, 'GET /top rejected: invalid wallet format');
      return res.status(400).json({
        error: 'Invalid wallet format. Expected EVM wallet like 0x... (40 hex chars).',
        requestId: req.requestId
      });
    }

    const topPlayers = await Player.find({ bestScore: { $gt: 0 } })
      .sort({ bestScore: -1 })
      .limit(10)
      .select('wallet bestScore bestDistance averageScore scoreToAverageRatio totalGoldCoins totalSilverCoins gamesPlayed');

    // Fetch AccountLink data for all top players to build displayName
    const wallets = topPlayers.map(p => p.wallet);
    const links = await AccountLink.find({ primaryId: { $in: wallets } });
    const linkMap = {};
    for (const link of links) {
      linkMap[link.primaryId] = link;
    }

    let playerPosition = null;
    let playerRecord = null;
    if (wallet) {
      const playerData = await Player.findOne({ wallet });
      if (playerData) {
        playerRecord = playerData;
        const playerLink = await AccountLink.findOne({ primaryId: wallet });

        if (playerData.bestScore > 0) {
          const position = await Player.countDocuments({
            bestScore: { $gt: playerData.bestScore }
          });

          playerPosition = buildLeaderboardEntry(
            playerData,
            buildDisplayName(playerLink, playerData.wallet),
            position + 1
          );
        } else {
          playerPosition = buildLeaderboardEntry(
            playerData,
            buildDisplayName(playerLink, playerData.wallet),
            null
          );
        }
      }
    }

    const includeInsights =
      leaderboardInsightsConfig.insightsEnabled &&
      wallet &&
      (req.query.v === '2' || req.query.includeInsights === 'true');

    const insights = includeInsights && playerRecord
      ? await computePlayerInsights({ wallet, player: playerRecord })
      : null;

    res.json({
      leaderboard: topPlayers.map((player, index) => (
        buildLeaderboardEntry(
          player,
          buildDisplayName(linkMap[player.wallet], player.wallet),
          index + 1
        )
      )),
      playerPosition,
      ...(insights ? { playerInsights: insights } : {})
    });

  } catch (error) {
    logger.error({ err: error.message, requestId: req.requestId }, 'GET /top error');
    res.status(500).json({ error: 'Server error', requestId: req.requestId });
  }
});

// ✅ POST: Save game result with signature verification
router.post('/save', saveResultLimiter, async (req, res) => {
  try {
    const { wallet, score, distance, goldCoins, silverCoins, signature, timestamp, authMode, telegramId, aiSettings } = req.body;

    const isTelegramAuth = authMode === 'telegram';

    if (isTelegramAuth) {
      if (!wallet || score === undefined || distance === undefined || !telegramId || !timestamp) {
        return res.status(400).json({
          error: 'Missing required fields: wallet, score, distance, telegramId, timestamp'
        });
      }
    } else {
      if (!wallet || score === undefined || distance === undefined || !signature || !timestamp) {
        return res.status(400).json({
          error: 'Missing required fields: wallet, score, distance, signature, timestamp'
        });
      }
    }

    const walletLower = normalizeWallet(wallet);
    const aiValidation = validateAiSettings(aiSettings);
    if (!aiValidation.valid) {
      return res.status(400).json({ error: aiValidation.error });
    }

    const aiConfig = aiValidation.sanitized;
    if (aiConfig?.enabled && !hasAiModeAccess(walletLower)) {
      return res.status(403).json({ error: 'AI mode is not allowed for this wallet' });
    }

    if (aiConfig?.enabled) {
      logger.info({ wallet: walletLower, aiSettings: aiConfig }, 'AI mode enabled for result submission');
    }

    // Anti-cheat: validate score, distance, and coin values
    if (typeof score !== 'number' || isNaN(score) || score < 0 || score > 999999) {
      markSuspicious('invalid_score_value');
      await logSecurityEvent({ wallet: walletLower, eventType: 'invalid_score_value', route: req.path, ipAddress: req.ip, details: { score } });
      return res.status(400).json({ error: 'Invalid score value' });
    }

    if (typeof distance !== 'number' || isNaN(distance) || distance < 0 || distance > 99999) {
      return res.status(400).json({ error: 'Invalid distance value' });
    }

    const goldCoinsVal = goldCoins ?? 0;
    const silverCoinsVal = silverCoins ?? 0;

    if (typeof goldCoinsVal !== 'number' || isNaN(goldCoinsVal) || goldCoinsVal < 0 || goldCoinsVal > 999) {
      return res.status(400).json({ error: 'Invalid goldCoins value' });
    }

    if (typeof silverCoinsVal !== 'number' || isNaN(silverCoinsVal) || silverCoinsVal < 0 || silverCoinsVal > 999) {
      return res.status(400).json({ error: 'Invalid silverCoins value' });
    }

    const coins = {
      gold: Math.floor(goldCoinsVal),
      silver: Math.floor(silverCoinsVal)
    };

    const maxPastAge = Number(process.env.MAX_RESULT_TIMESTAMP_AGE_MS || 2 * 60 * 60 * 1000);
    const maxFutureSkew = Number(process.env.MAX_RESULT_FUTURE_SKEW_MS || 3 * 60 * 1000);
    const timestampValidation = validateTimestampWindow(timestamp, {
      maxPastAgeMs: maxPastAge,
      maxFutureSkewMs: maxFutureSkew
    });

    if (!timestampValidation.valid) {
      if (timestampValidation.error === 'Invalid timestamp format') {
        return res.status(400).json({ error: timestampValidation.error });
      }

      const { ageMs } = timestampValidation;
      markSuspicious('invalid_timestamp');
      await logSecurityEvent({
        wallet: walletLower,
        eventType: 'invalid_timestamp',
        route: req.path,
        ipAddress: req.ip,
        details: { ageMs, maxPastAge, maxFutureSkew }
      });

      logger.warn({ wallet: walletLower, ageMs, maxPastAge, maxFutureSkew }, 'Timestamp invalid');
      return res.status(400).json({ error: timestampValidation.error });
    }

    const now = Date.now();
    const { normalizedTs: ts, ageMs } = timestampValidation;

    logger.info({ serverTime: now, clientTimestamp: ts, ageMs }, 'Result timestamp check');

    if (isTelegramAuth) {
      // Verify that the telegramId matches the claimed primaryId (wallet) via AccountLink
      const link = await AccountLink.findOne({ telegramId: String(telegramId) });
      if (!link || link.primaryId !== walletLower) {
        return res.status(401).json({ error: 'Telegram identity verification failed' });
      }

      logger.info({ wallet: walletLower }, 'Telegram identity verified');
    } else {
      // Signature verification
      // Keep the exact wallet string provided by client in signed payload.
      // EIP-191 signatures are case-sensitive for message contents,
      // so lowercasing here can break verification for checksum addresses.
      const messageToVerify = createMessageToVerify(wallet, score, distance, timestamp);

      logger.info({ wallet: walletLower, messageToVerify }, 'Message for verification');
      const isSignatureValid = verifySignature(messageToVerify, signature, walletLower);

      if (!isSignatureValid) {
        logger.warn({ wallet: walletLower }, 'Invalid signature');
        return res.status(401).json({
          error: 'Invalid signature. Result cannot be verified.',
          details: 'Your wallet signature does not match the submitted data.'
        });
      }

      logger.info({ wallet: walletLower }, 'Signature valid');
    }

    // Duplicate prevention
    let deduplicationToken;
    if (isTelegramAuth) {
      // For telegram auth, generate a unique token from the result data
      deduplicationToken = crypto
        .createHash('sha256')
        .update(`${walletLower}:${Math.floor(score)}:${Math.floor(distance)}:${timestamp}`)
        .digest('hex');
    } else {
      deduplicationToken = signature;
    }

    const scoreValue = Math.floor(score);
    const distanceValue = Math.floor(distance);
    let responsePayload;

    const persistResultAndPlayer = async (session = null) => {
      const gameResultQuery = GameResult.findOne({ signature: deduplicationToken });
      if (session) {
        gameResultQuery.session(session);
      }

      const existingResult = await gameResultQuery;
      if (existingResult) {
        const duplicateError = new Error('DUPLICATE_RESULT');
        duplicateError.code = 409;
        throw duplicateError;
      }

      const createGameResultPayload = [{
        wallet: walletLower,
        score: scoreValue,
        distance: distanceValue,
        goldCoins: coins.gold,
        silverCoins: coins.silver,
        signature: deduplicationToken,
        timestamp,
        ipAddress: req.ip,
        verified: true
      }];

      if (session) {
        await GameResult.create(createGameResultPayload, { session });
      } else {
        await GameResult.create(createGameResultPayload);
      }

      // Update player stats in the same flow as GameResult creation
      const playerQuery = Player.findOne({ wallet: walletLower });
      if (session) {
        playerQuery.session(session);
      }

      let player = await playerQuery;
      const previousBestScore = player?.bestScore || 0;
      const previousGamesPlayed = player?.gamesPlayed || 0;

      if (!player) {
        player = new Player({
          wallet: walletLower,
          bestScore: scoreValue,
          bestDistance: distanceValue,
          totalGoldCoins: coins.gold,
          totalSilverCoins: coins.silver,
          gamesPlayed: 1,
          gameHistory: [{
            score: scoreValue,
            distance: distanceValue,
            goldCoins: coins.gold,
            silverCoins: coins.silver,
            timestamp: new Date()
          }]
        });
      } else {
        if (scoreValue > player.bestScore) {
          logger.info({ wallet: walletLower, newBestScore: scoreValue, previousBestScore: player.bestScore }, 'New best score');
          player.bestScore = scoreValue;
        }

        if (distanceValue > player.bestDistance) {
          logger.info({ wallet: walletLower, newBestDistance: distanceValue, previousBestDistance: player.bestDistance }, 'New best distance');
          player.bestDistance = distanceValue;
        }

        player.totalGoldCoins += coins.gold;
        player.totalSilverCoins += coins.silver;
        player.gamesPlayed += 1;

        player.gameHistory.push({
          score: scoreValue,
          distance: distanceValue,
          goldCoins: coins.gold,
          silverCoins: coins.silver,
          timestamp: new Date()
        });

        if (player.gameHistory.length > 100) {
          player.gameHistory.shift();
        }
      }

      const totalScore = player.gameHistory.reduce((sum, game) => sum + (game.score || 0), 0);
      const averageScore = player.gameHistory.length > 0
        ? Math.round(totalScore / player.gameHistory.length)
        : 0;

      player.averageScore = averageScore;
      player.scoreToAverageRatio = averageScore > 0
        ? Number((player.bestScore / averageScore).toFixed(2))
        : null;

      const suspiciousThreshold = 4.5;
      player.suspiciousScorePattern = Boolean(
        player.scoreToAverageRatio &&
        player.gamesPlayed >= 10 &&
        player.scoreToAverageRatio >= suspiciousThreshold
      );

      if (player.suspiciousScorePattern) {
        markSuspicious('score_peak_vs_average');
        await logSecurityEvent({
          wallet: walletLower,
          eventType: 'suspicious_score_pattern',
          route: req.path,
          ipAddress: req.ip,
          details: {
            bestScore: player.bestScore,
            averageScore: player.averageScore,
            scoreToAverageRatio: player.scoreToAverageRatio
          }
        });

        logger.warn({
          wallet: walletLower,
          bestScore: player.bestScore,
          averageScore: player.averageScore,
          ratio: player.scoreToAverageRatio
        }, 'Suspicious score pattern detected');
      }

      player.updatedAt = new Date();
      if (session) {
        await player.save({ session });
      } else {
        await player.save();
      }

      const runPayload = {
        playerId: player._id,
        wallet: walletLower,
        runId: deduplicationToken,
        score: scoreValue,
        distance: distanceValue,
        goldCoins: coins.gold,
        silverCoins: coins.silver,
        isFirstRun: previousGamesPlayed === 0,
        isPersonalBest: scoreValue > previousBestScore,
        verified: true,
        isValid: !player.suspiciousScorePattern
      };

      if (session) {
        await PlayerRun.create([runPayload], { session });
      } else {
        await PlayerRun.create([runPayload]);
      }

      responsePayload = {
        bestScore: player.bestScore,
        averageScore: player.averageScore || 0,
        scoreToAverageRatio: player.scoreToAverageRatio || null,
        suspiciousScorePattern: player.suspiciousScorePattern || false,
        bestDistance: player.bestDistance,
        totalGoldCoins: player.totalGoldCoins,
        totalSilverCoins: player.totalSilverCoins,
        gamesPlayed: player.gamesPlayed
      };
    };

    try {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await persistResultAndPlayer(session);
        });
      } finally {
        await session.endSession();
      }
    } catch (txError) {
      const txErrorMessage = txError?.message || '';
      const isTransactionUnsupported =
        txError?.code === 20 ||
        txError?.codeName === 'IllegalOperation' ||
        /Transaction numbers are only allowed on a replica set member or mongos/i.test(txErrorMessage) ||
        /Transaction.*not supported/i.test(txErrorMessage);

      if (!isTransactionUnsupported) {
        throw txError;
      }

      logger.warn({ err: txError }, 'Mongo transactions unavailable. Falling back to non-transactional save flow');

      await persistResultAndPlayer();
    }

    logger.info({
      wallet: walletLower,
      bestScore: responsePayload.bestScore,
      bestDistance: responsePayload.bestDistance,
      totalGoldCoins: responsePayload.totalGoldCoins,
      totalSilverCoins: responsePayload.totalSilverCoins
    }, 'Result saved (VERIFIED)');

    res.json({
      success: true,
      message: 'Result saved successfully with valid signature',
      bestScore: responsePayload.bestScore,
      averageScore: responsePayload.averageScore,
      scoreToAverageRatio: responsePayload.scoreToAverageRatio,
      suspiciousScorePattern: responsePayload.suspiciousScorePattern,
      bestDistance: responsePayload.bestDistance,
      totalGoldCoins: responsePayload.totalGoldCoins,
      totalSilverCoins: responsePayload.totalSilverCoins,
      gamesPlayed: responsePayload.gamesPlayed
    });

  } catch (error) {
    if (error?.code === 409 || error?.code === 11000) {
      return res.status(409).json({
        error: 'This result has already been submitted.'
      });
    }

    logger.error({ err: error }, 'POST /save error');
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/insights', readLimiter, async (req, res) => {
  try {
    if (!leaderboardInsightsConfig.insightsEnabled) {
      return res.status(404).json({ error: 'Insights are disabled by feature flag.' });
    }

    const walletQuery = typeof req.query.wallet === 'string' ? req.query.wallet.trim() : '';
    const wallet = walletQuery ? walletQuery.toLowerCase() : null;

    if (!wallet || !isValidWalletAddress(wallet)) {
      return res.status(400).json({
        error: 'Invalid wallet format. Expected EVM wallet like 0x... (40 hex chars).'
      });
    }

    const player = await Player.findOne({ wallet });
    if (!player) {
      return res.json({ wallet, playerInsights: null });
    }

    const playerInsights = await computePlayerInsights({ wallet, player });
    return res.json({ wallet, playerInsights });
  } catch (error) {
    logger.error({ err: error.message, requestId: req.requestId }, 'GET /insights error');
    return res.status(500).json({ error: 'Server error', requestId: req.requestId });
  }
});

// ✅ GET: Verified results for a wallet
router.get('/verified-results/:wallet', readLimiter, async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();

    const results = await GameResult.find({ wallet, verified: true })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('score distance goldCoins silverCoins timestamp verified');

    res.json({ wallet, count: results.length, results });

  } catch (error) {
    logger.error({ err: error }, 'GET /verified-results error');
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ GET: Player info
router.get('/player/:wallet', readLimiter, async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();

    // Accept both wallet addresses and tg_ prefixed IDs
    const player = await Player.findOne({ wallet });

    if (!player) {
      return res.status(200).json({
        wallet: wallet,
        position: null,
        bestScore: 0,
        averageScore: 0,
        scoreToAverageRatio: null,
        suspiciousScorePattern: false,
        bestDistance: 0,
        totalGoldCoins: 0,
        totalSilverCoins: 0,
        gamesPlayed: 0,
        gameHistory: [],
        message: 'New player - no previous results'
      });
    }

    let position = null;
    if (player.bestScore > 0) {
      const count = await Player.countDocuments({
        bestScore: { $gt: player.bestScore }
      });
      position = count + 1;
    }

    res.json({
      wallet: player.wallet,
      position: position,
      bestScore: player.bestScore,
      averageScore: player.averageScore || 0,
      scoreToAverageRatio: player.scoreToAverageRatio || null,
      suspiciousScorePattern: player.suspiciousScorePattern || false,
      bestDistance: player.bestDistance,
      totalGoldCoins: player.totalGoldCoins,
      totalSilverCoins: player.totalSilverCoins,
      gamesPlayed: player.gamesPlayed,
      gameHistory: player.gameHistory.slice(-10).reverse()
    });

  } catch (error) {
    logger.error({ err: error }, 'GET /player error');
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
