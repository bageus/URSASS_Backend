const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const mongoose = require('mongoose');
const { renderScoreSharePng } = require('../utils/shareCard');
const Player = require('../models/Player');
const GameResult = require('../models/GameResult');
const AccountLink = require('../models/AccountLink');
const PlayerRun = require('../models/PlayerRun');
const { verifySignature, createMessageToVerify } = require('../utils/verifySignature');
const { saveResultLimiter, readLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');
const { markSuspicious } = require('../middleware/requestMetrics');
const {
  logSecurityEvent,
  normalizeWallet,
  validateTimestampWindow,
  isValidWalletAddress,
  parseWalletOrNull,
  buildInvalidWalletError
} = require('../utils/security');
const { hasAiModeAccess, hasAiModeAccessByTelegramUsername, validateAiSettings } = require('../utils/aiModeAccess');
const { computePlayerInsights, computeRank, DEFAULTS: leaderboardInsightsConfig } = require('../services/leaderboardInsightsService');
const { buildGameOverPayload } = require('../services/gameOverAgitationService');
const { maybeGrantReferralRewards } = require('../utils/referralRewards');
const { recordCoinReward } = require('../utils/coinHistory');
const {
  getLeaderboardCache,
  setLeaderboardCache,
  invalidateLeaderboardCache,
  getStats: getLeaderboardCacheStats
} = require('../services/leaderboardCacheService');
const { resolveLeaderboardDisplayName } = require('../services/displayNamePolicyService');

const SHARE_COPY_TEMPLATE = 'I scored {score} in Ursass Tube 🐻\nCan you beat me?';
const SHARE_HASHTAGS = '#UrsassTube #Ursas #Ursasplanet #GameChallenge #HighScore';
const TOP_CACHE_TTL_MS = (process.env.NODE_ENV === 'test')
  ? 0
  : Math.max(1_000, Number(process.env.LEADERBOARD_TOP_CACHE_TTL_MS || 30_000));
const topLeaderboardCache = { value: null, expiresAt: 0, hits: 0, misses: 0 };

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getPublicBaseUrl(req) {
  const configured = (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  return `${req.protocol}://${req.get('host')}`;
}

async function resolveShareContextByWallet(wallet) {
  const player = await Player.findOne({ wallet }).select('wallet bestScore');
  if (!player) {
    return null;
  }

  const latestRun = await PlayerRun.findOne({ wallet, verified: true, isValid: true })
    .sort({ createdAt: -1 })
    .select('score isPersonalBest createdAt');

  const personalBestScore = Math.max(0, Number(player.bestScore || 0));
  const latestRunScore = latestRun ? Math.max(0, Number(latestRun.score || 0)) : 0;
  const isLatestRunPersonalBest = Boolean(latestRun?.isPersonalBest && latestRunScore > 0);
  const scoreForShare = isLatestRunPersonalBest
    ? latestRunScore
    : Math.max(personalBestScore, latestRunScore);

  return {
    wallet: player.wallet,
    scoreForShare,
    personalBestScore,
    latestRunScore,
    isLatestRunPersonalBest
  };
}

async function loadShareContextByWallet(req, res, next) {
  try {
    const wallet = parseWalletOrNull(req.params.wallet);
    if (TOP_CACHE_TTL_MS > 0 && !wallet) {
      return res.status(400).json(buildInvalidWalletError());
    }

    const shareContext = await resolveShareContextByWallet(wallet);
    if (!shareContext) {
      return res.status(404).json({ error: 'Player not found' });
    }

    req.shareWallet = wallet;
    req.shareContext = shareContext;
    return next();
  } catch (error) {
    logger.error({ err: error.message, requestId: req.requestId }, 'loadShareContextByWallet middleware error');
    return res.status(500).json({ error: 'Server error', requestId: req.requestId });
  }
}

async function loadSharePageContextByWallet(req, res, next) {
  try {
    const wallet = parseWalletOrNull(req.params.wallet);
    if (TOP_CACHE_TTL_MS > 0 && !wallet) {
      return res.status(400).send('Invalid wallet');
    }

    const shareContext = await resolveShareContextByWallet(wallet);
    if (!shareContext) {
      return res.status(404).send('Player not found');
    }

    req.shareWallet = wallet;
    req.shareContext = shareContext;
    return next();
  } catch (error) {
    logger.error({ err: error.message, requestId: req.requestId }, 'loadSharePageContextByWallet middleware error');
    return res.status(500).send('Server error');
  }
}

function buildSharePostText(score, referralLink = '') {
  const normalizedScore = Math.max(0, Math.floor(Number(score || 0)));
  const main = SHARE_COPY_TEMPLATE.replace('{score}', normalizedScore);
  const parts = [main, referralLink.trim(), SHARE_HASHTAGS].filter(Boolean);
  return parts.join('\n');
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

// ✅ GET: Top 10 players
router.get('/top', readLimiter, async (req, res) => {
  try {
    const walletQuery = typeof req.query.wallet === 'string' ? req.query.wallet.trim() : '';
    const wallet = walletQuery ? parseWalletOrNull(walletQuery) : null;

    if (walletQuery && !wallet) {
      logger.warn({ wallet: walletQuery, requestId: req.requestId }, 'GET /top rejected: invalid wallet format');
      return res.status(400).json({
        ...buildInvalidWalletError(),
        requestId: req.requestId
      });
    }

    if (TOP_CACHE_TTL_MS > 0 && !wallet && topLeaderboardCache.value && topLeaderboardCache.expiresAt > Date.now()) {
      topLeaderboardCache.hits += 1;
      res.setHeader('X-Leaderboard-Cache', 'hit');
      res.setHeader('X-Leaderboard-Cache-Hits', String(stats.hits));
      res.setHeader('X-Leaderboard-Cache-Misses', String(stats.misses));
      return res.json(cachedPayload);
    }

    const topPlayers = await Player.find({ bestScore: { $gt: 0 } })
      .sort({ bestScore: -1 })
      .limit(10)
      .select('wallet bestScore bestDistance averageScore scoreToAverageRatio totalGoldCoins totalSilverCoins gamesPlayed nickname leaderboardDisplay');

    // Fetch AccountLink data for all top players to build displayName.
    // A wallet-linked player may have Player.wallet = EVM address but
    // AccountLink.primaryId = tg_<id> (when they first logged in via TG).
    // So we search by both primaryId and wallet fields.
    const wallets = topPlayers.map(p => p.wallet).filter(Boolean);
    const links = await AccountLink.find({
      $or: [
        { primaryId: { $in: wallets } },
        { wallet: { $in: wallets } }
      ]
    });
    const linkMap = {};
    for (const link of links) {
      if (link.primaryId) linkMap[link.primaryId] = link;
      if (link.wallet) linkMap[link.wallet] = link;
    }

    let playerPosition = null;
    let playerRecord = null;
    if (wallet) {
      const playerData = await Player.findOne({ wallet })
        .select('wallet bestScore bestDistance averageScore scoreToAverageRatio totalGoldCoins totalSilverCoins gamesPlayed nickname leaderboardDisplay');
      if (playerData) {
        playerRecord = playerData;
        const playerLink = await AccountLink.findOne({ $or: [{ primaryId: wallet }, { wallet }] });

        if (playerData.bestScore > 0) {
          const position = await Player.countDocuments({
            bestScore: { $gt: playerData.bestScore }
          });

          playerPosition = buildLeaderboardEntry(
            playerData,
            resolveLeaderboardDisplayName({
              leaderboardDisplay: playerData.leaderboardDisplay,
              nickname: playerData.nickname,
              telegramUsername: playerLink ? playerLink.telegramUsername : null,
              wallet: playerLink ? playerLink.wallet : null
            }),
            position + 1
          );
        } else {
          playerPosition = buildLeaderboardEntry(
            playerData,
            resolveLeaderboardDisplayName({
              leaderboardDisplay: playerData.leaderboardDisplay,
              nickname: playerData.nickname,
              telegramUsername: playerLink ? playerLink.telegramUsername : null,
              wallet: playerLink ? playerLink.wallet : null
            }),
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

    const responsePayload = {
      leaderboard: topPlayers.map((player, index) => (
        buildLeaderboardEntry(
          player,
          resolveLeaderboardDisplayName({
            leaderboardDisplay: player.leaderboardDisplay,
            nickname: player.nickname,
            telegramUsername: linkMap[player.wallet] ? linkMap[player.wallet].telegramUsername : null,
            wallet: linkMap[player.wallet] ? linkMap[player.wallet].wallet : null
          }),
          index + 1
        )
      )),
      playerPosition,
      ...(insights ? { playerInsights: insights } : {})
    };
    if (TOP_CACHE_TTL_MS > 0 && !wallet) {
      topLeaderboardCache.value = responsePayload;
      topLeaderboardCache.expiresAt = Date.now() + TOP_CACHE_TTL_MS;
    }
    res.setHeader('X-Leaderboard-Cache', 'miss');
    res.setHeader('X-Leaderboard-Cache-Hits', String(stats.hits));
    res.setHeader('X-Leaderboard-Cache-Misses', String(stats.misses));
    res.json(responsePayload);

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
    let hasAiAccess = hasAiModeAccess(walletLower);
    if (!hasAiAccess && isTelegramAuth && telegramId) {
      const tgLink = await AccountLink.findOne({ telegramId: String(telegramId) });
      hasAiAccess = hasAiModeAccessByTelegramUsername(tgLink?.telegramUsername);
    }

    if (aiConfig?.enabled && !hasAiAccess) {
      return res.status(403).json({ error: 'AI mode is not allowed for this wallet or telegram username' });
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
    let runContext;

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

      runContext = {
        run: runPayload,
        previousBestScore,
        prevRank: player?.lastSeenRank ?? null,
        isFirstRunAfterAuth: previousGamesPlayed === 0
      };

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

    if (coins.gold > 0 || coins.silver > 0) {
      await recordCoinReward(walletLower, 'ride', { gold: coins.gold, silver: coins.silver }, { requestId: req.requestId });
    }

    await invalidateLeaderboardCache([
      LEADERBOARD_CACHE_KEYS.anonymousTop,
      LEADERBOARD_CACHE_KEYS.personalizedTop(walletLower)
    ]);

    // Grant referral rewards on first valid run (non-blocking, errors logged internally)
    try {
      const savedPlayer = await Player.findOne({ wallet: walletLower });
      if (savedPlayer) {
        await maybeGrantReferralRewards(savedPlayer, { requestId: req.requestId });
      }
    } catch (refErr) {
      logger.error({ err: refErr, wallet: walletLower }, 'maybeGrantReferralRewards failed');
    }

    // Update lastSeenRank baseline after completed game (non-blocking)
    try {
      const playerForRank = await Player.findOne({ wallet: walletLower });
      if (playerForRank) {
        const { rank: freshRank } = await computeRank(playerForRank.bestScore);
        if (freshRank !== null) {
          playerForRank.lastSeenRank = freshRank;
          await playerForRank.save();
        }
      }
    } catch (rankErr) {
      logger.error({ err: rankErr, wallet: walletLower }, 'Failed to update lastSeenRank after game');
    }

    const playerForInsights = {
      bestScore: responsePayload.bestScore
    };

    const gameOverInsights = leaderboardInsightsConfig.insightsEnabled
      ? await computePlayerInsights({ wallet: walletLower, player: playerForInsights, latestRun: runContext?.run })
      : null;

    const gameOverPrompt = await buildGameOverPayload({
      insights: gameOverInsights,
      run: runContext?.run || { score: scoreValue, isFirstRun: false, isPersonalBest: false },
      previousBestScore: runContext?.previousBestScore || 0,
      isAuthenticated: true,
      wallet: walletLower,
      prevRank: runContext?.prevRank ?? null,
      isFirstRunAfterAuth: runContext?.isFirstRunAfterAuth ?? false
    });

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
      gamesPlayed: responsePayload.gamesPlayed,
      gameOverPrompt,
      ...(gameOverInsights ? { playerInsights: gameOverInsights } : {})
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


router.post('/game-over-preview', readLimiter, async (req, res) => {
  try {
    const score = Number(req.body?.score || 0);
    const distance = Number(req.body?.distance || 0);
    const isAuthenticated = Boolean(req.body?.isAuthenticated);

    if (!Number.isFinite(score) || score < 0) {
      return res.status(400).json({ error: 'Invalid score value' });
    }

    if (!Number.isFinite(distance) || distance < 0) {
      return res.status(400).json({ error: 'Invalid distance value' });
    }

    let rank = null;
    if (score > 0) {
      const better = await Player.countDocuments({ bestScore: { $gt: score } });
      rank = better + 1;
    }

    const pseudoInsights = {
      rank,
      percentileFirstRunScore: null,
      recommendedTarget: null
    };

    const gameOverPrompt = await buildGameOverPayload({
      insights: pseudoInsights,
      run: {
        score: Math.floor(score),
        distance: Math.floor(distance),
        isFirstRun: false,
        isPersonalBest: false
      },
      previousBestScore: 0,
      isAuthenticated
    });

    return res.json({ gameOverPrompt });
  } catch (error) {
    logger.error({ err: error.message, requestId: req.requestId }, 'POST /game-over-preview error');
    return res.status(500).json({ error: 'Server error', requestId: req.requestId });
  }
});

router.get('/share/payload/:wallet', readLimiter, loadShareContextByWallet, async (req, res) => {
  try {
    const wallet = req.shareWallet;
    const shareContext = req.shareContext;

    const baseUrl = getPublicBaseUrl(req);
    const shareUrl = `${baseUrl}/api/leaderboard/share/page/${wallet}`;
    const shareImageUrl = `${baseUrl}/api/leaderboard/share/image/${wallet}.png`;
    const postText = buildSharePostText(shareContext.scoreForShare, '');

    return res.json({
      wallet,
      scoreForShare: shareContext.scoreForShare,
      latestRunScore: shareContext.latestRunScore,
      personalBestScore: shareContext.personalBestScore,
      isLatestRunPersonalBest: shareContext.isLatestRunPersonalBest,
      shareUrl,
      shareImageUrl,
      postText
    });
  } catch (error) {
    logger.error({ err: error.message, requestId: req.requestId }, 'GET /share/payload/:wallet error');
    return res.status(500).json({ error: 'Server error', requestId: req.requestId });
  }
});

router.get('/share/image/:wallet.svg', readLimiter, loadShareContextByWallet, async (req, res) => {
  try {
    const shareContext = req.shareContext;

    const score = shareContext.scoreForShare;
    const externalBackground = (process.env.SHARE_CARD_BACKGROUND_URL || '').trim();
    const imageLayer = externalBackground
      ? `<image href="${escapeHtml(externalBackground)}" x="0" y="0" width="1200" height="630" preserveAspectRatio="xMidYMid slice" />`
      : '';

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#080426"/>
      <stop offset="100%" stop-color="#121f68"/>
    </linearGradient>
    <linearGradient id="num" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#a55bff"/>
      <stop offset="100%" stop-color="#44d2ff"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />
  ${imageLayer}
  <rect x="36" y="36" width="1128" height="558" rx="28" fill="rgba(3, 4, 20, 0.52)" stroke="rgba(115, 120, 255, 0.55)" />
  <text x="88" y="180" fill="#ffffff" font-size="76" font-weight="800" font-family="Arial, Helvetica, sans-serif">I SCORED</text>
  <text x="88" y="312" fill="url(#num)" font-size="150" font-weight="900" font-family="Arial Black, Arial, Helvetica, sans-serif">${score}</text>
  <text x="88" y="412" fill="#ffffff" font-size="68" font-weight="700" font-family="Arial, Helvetica, sans-serif">CAN YOU</text>
  <text x="88" y="510" fill="url(#num)" font-size="104" font-weight="900" font-family="Arial Black, Arial, Helvetica, sans-serif">BEAT ME?</text>
  <text x="88" y="568" fill="#8fe6ff" font-size="30" font-family="Arial, Helvetica, sans-serif">ursasstube.fun</text>
</svg>`;

    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.send(svg);
  } catch (error) {
    logger.error({ err: error.message, requestId: req.requestId }, 'GET /share/image/:wallet.svg error');
    return res.status(500).json({ error: 'Server error', requestId: req.requestId });
  }
});

router.get('/share/image/:wallet.png', readLimiter, loadShareContextByWallet, async (req, res) => {
  try {
    const shareContext = req.shareContext;

    const score = shareContext.scoreForShare;
    const pngBuffer = await renderScoreSharePng(score);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(pngBuffer);
  } catch (error) {
    if (error?.code === 'share_png_unavailable') {
      return res.status(503).json({ error: 'PNG rendering unavailable' });
    }
    logger.error({ err: error.message, requestId: req.requestId }, 'GET /share/image/:wallet.png error');
    return res.status(500).json({ error: 'Server error', requestId: req.requestId });
  }
});

router.get('/share/page/:wallet', readLimiter, loadSharePageContextByWallet, async (req, res) => {
  try {
    const wallet = req.shareWallet;
    const shareContext = req.shareContext;

    const baseUrl = getPublicBaseUrl(req);
    const score = shareContext.scoreForShare;
    const shareImageUrl = `${baseUrl}/api/leaderboard/share/image/${wallet}.png`;
    const referralLink = '';
    const postText = buildSharePostText(score, referralLink);
    const title = `I scored ${score} in Ursass Tube 🐻`;
    const description = `Can you beat me? ${SHARE_HASHTAGS}`;

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(shareImageUrl)}" />
  <meta property="og:url" content="${escapeHtml(`${baseUrl}/api/leaderboard/share/page/${wallet}`)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(shareImageUrl)}" />
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: Arial, sans-serif; background: #090b2d; color: #fff; }
    main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
    .card { max-width: 680px; width: 100%; background: #111438; border-radius: 16px; padding: 20px; box-shadow: 0 10px 32px rgba(0,0,0,.45);}
    img { width: 100%; border-radius: 12px; border: 1px solid rgba(255,255,255,.12);}
    pre { white-space: pre-wrap; background: #090b2d; padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,.1);}
    a.btn { display: inline-block; text-decoration: none; color: #fff; background: linear-gradient(90deg,#a55bff,#44d2ff); padding: 10px 14px; border-radius: 9px; font-weight: 700;}
  </style>
</head>
<body>
  <main>
    <article class="card">
      <h1>${escapeHtml(title)}</h1>
      <img src="${escapeHtml(shareImageUrl)}" alt="Ursass Tube share card" />
      <p>Share text:</p>
      <pre>${escapeHtml(postText)}</pre>
      <a class="btn" href="https://ursasstube.fun" rel="noopener noreferrer">Play now</a>
    </article>
  </main>
</body>
</html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.send(html);
  } catch (error) {
    logger.error({ err: error.message, requestId: req.requestId }, 'GET /share/page/:wallet error');
    return res.status(500).json({ error: 'Server error', requestId: req.requestId });
  }
});

router.get('/insights', readLimiter, async (req, res) => {
  try {
    if (!leaderboardInsightsConfig.insightsEnabled) {
      return res.status(404).json({ error: 'Insights are disabled by feature flag.' });
    }

    const wallet = parseWalletOrNull(req.query.wallet);
    if (TOP_CACHE_TTL_MS > 0 && !wallet) {
      return res.status(400).json(buildInvalidWalletError());
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
