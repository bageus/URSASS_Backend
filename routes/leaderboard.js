const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Player = require('../models/Player');
const GameResult = require('../models/GameResult');
const AccountLink = require('../models/AccountLink');
const { verifySignature, createMessageToVerify } = require('../utils/verifySignature');
const { saveResultLimiter, readLimiter } = require('../middleware/rateLimiter');
const SecurityEvent = require('../models/SecurityEvent');
const logger = require('../utils/logger');
const { markSuspicious } = require('../middleware/requestMetrics');
const { executeInTransaction } = require('../utils/transaction');
const { consumeAuthChallenge } = require('../utils/authChallenge');


async function logSecurityEvent({ wallet = null, eventType, route, ipAddress, details = {} }) {
  try {
    await SecurityEvent.create({ wallet, eventType, route, ipAddress, details });
  } catch (error) {
    logger.warn({ error: error.message, eventType }, 'Failed to persist SecurityEvent');
  }
}

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

// ✅ GET: Top 10 players
router.get('/top', readLimiter, async (req, res) => {
  try {
    const wallet = req.query.wallet?.toLowerCase();

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
    if (wallet) {
      const playerData = await Player.findOne({ wallet });
      if (playerData) {
        const playerLink = await AccountLink.findOne({ primaryId: wallet });

        if (playerData.bestScore > 0) {
          const position = await Player.countDocuments({
            bestScore: { $gt: playerData.bestScore }
          });

          playerPosition = {
            position: position + 1,
            wallet: playerData.wallet,
            displayName: buildDisplayName(playerLink, playerData.wallet),
            bestScore: playerData.bestScore,
            averageScore: playerData.averageScore || 0,
            scoreToAverageRatio: playerData.scoreToAverageRatio || null,
            bestDistance: playerData.bestDistance,
            totalGoldCoins: playerData.totalGoldCoins,
            totalSilverCoins: playerData.totalSilverCoins,
            gamesPlayed: playerData.gamesPlayed
          };
        } else {
          // Player has 0 score — no position
          playerPosition = {
            position: null,
            wallet: playerData.wallet,
            displayName: buildDisplayName(playerLink, playerData.wallet),
            bestScore: playerData.bestScore,
            averageScore: playerData.averageScore || 0,
            scoreToAverageRatio: playerData.scoreToAverageRatio || null,
            bestDistance: playerData.bestDistance,
            totalGoldCoins: playerData.totalGoldCoins,
            totalSilverCoins: playerData.totalSilverCoins,
            gamesPlayed: playerData.gamesPlayed
          };
        }
      }
    }

    res.json({
      leaderboard: topPlayers.map((player, index) => ({
        position: index + 1,
        wallet: player.wallet,
        displayName: buildDisplayName(linkMap[player.wallet], player.wallet),
        bestScore: player.bestScore,
        averageScore: player.averageScore || 0,
        scoreToAverageRatio: player.scoreToAverageRatio || null,
        bestDistance: player.bestDistance,
        totalGoldCoins: player.totalGoldCoins,
        totalSilverCoins: player.totalSilverCoins,
        gamesPlayed: player.gamesPlayed
      })),
      playerPosition
    });

  } catch (error) {
    logger.error({ err: error }, 'GET /top error');
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ POST: Save game result with signature verification
router.post('/save', saveResultLimiter, async (req, res) => {
  try {
        const {
      wallet,
      score,
      distance,
      goldCoins,
      silverCoins,
      signature,
      timestamp,
      authMode,
      telegramId,
      challengeToken
    } = req.body;

    const isTelegramAuth = authMode === 'telegram';

    if (isTelegramAuth) {
       if (!wallet || score === undefined || distance === undefined || !telegramId || !timestamp || !challengeToken) {
        return res.status(400).json({
          error: 'Missing required fields: wallet, score, distance, telegramId, timestamp, challengeToken
        });
      }
    } else {
      if (!wallet || score === undefined || distance === undefined || !signature || !timestamp) {
        return res.status(400).json({
          error: 'Missing required fields: wallet, score, distance, signature, timestamp'
        });
      }
    }

    const walletLower = wallet.toLowerCase();

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

    const ts = typeof timestamp === 'number' ? timestamp : parseInt(timestamp, 10);

    if (!ts || isNaN(ts)) {
      return res.status(400).json({ error: 'Invalid timestamp format' });
    }

    const now = Date.now();
    const timeDiff = Math.abs(now - ts);
    const MAX_TIME_DIFF = Number(process.env.MAX_RESULT_TIMESTAMP_DIFF_MS || 3 * 60 * 1000);

    logger.debug({ now, ts, timeDiff }, 'Result timestamp check');

    if (timeDiff > MAX_TIME_DIFF) {
      markSuspicious('invalid_timestamp');
      await logSecurityEvent({
        wallet: walletLower,
        eventType: 'invalid_timestamp',
        route: req.path,
        ipAddress: req.ip,
        details: { timeDiff, maxAllowed: MAX_TIME_DIFF }
      });

      logger.warn({ wallet: walletLower, timeDiff, maxAllowed: MAX_TIME_DIFF }, 'Timestamp invalid');
      return res.status(400).json({
        error: `Invalid timestamp. Difference: ${timeDiff}ms.`
      });
    }

    if (isTelegramAuth) {
      // Verify that the telegramId matches the claimed primaryId (wallet) via AccountLink
            const link = await AccountLink.findOne({ telegramId: String(telegramId) });
      if (!link || link.primaryId !== walletLower) {
        return res.status(401).json({ error: 'Telegram identity verification failed' });
      }

      const isChallengeValid = await consumeAuthChallenge({
        token: challengeToken,
        type: 'telegram_result_submit',
        primaryId: walletLower,
        telegramId: String(telegramId)
      });

      if (!isChallengeValid) {
        return res.status(401).json({ error: 'Invalid or expired challenge token' });
      }

      logger.info({ wallet: walletLower, telegramId: String(telegramId) }, 'Telegram identity verified');
    } else {
      // Signature verification
      const messageToVerify = createMessageToVerify(walletLower, score, distance, timestamp);

      logger.debug({ wallet: walletLower, messageToVerify }, 'Verifying signed result');
      const isSignatureValid = verifySignature(messageToVerify, signature, walletLower);

      if (!isSignatureValid) {
        logger.warn({ wallet: walletLower }, 'Invalid result signature');
        return res.status(401).json({
          error: 'Invalid signature. Result cannot be verified.',
          details: 'Your wallet signature does not match the submitted data.'
        });
      }

      logger.info({ wallet: walletLower }, 'Result signature verified');
    }

    const saveOutcome = await executeInTransaction(async (session) => {
      const sessionOpts = session ? { session } : {};

      // Duplicate prevention
      let deduplicationToken;
      if (isTelegramAuth) {
        deduplicationToken = crypto
          .createHash('sha256')
          .update(`${walletLower}:${Math.floor(score)}:${Math.floor(distance)}:${timestamp}`)
          .digest('hex');
      } else {
        deduplicationToken = signature;
      }

      const existingResult = await GameResult.findOne({ signature: deduplicationToken }, null, sessionOpts);
      if (existingResult) {
        const err = new Error('This result has already been submitted.');
        err.status = 400;
        throw err;
      }

      const gameResult = new GameResult({
        wallet: walletLower,
        score: Math.floor(score),
        distance: Math.floor(distance),
        goldCoins: coins.gold,
        silverCoins: coins.silver,
        signature: deduplicationToken,
        timestamp,
        ipAddress: req.ip,
        verified: true
      });

      await gameResult.save(sessionOpts);

      let player = await Player.findOne({ wallet: walletLower }, null, sessionOpts);

      if (!player) {
        player = new Player({
          wallet: walletLower,
          bestScore: Math.floor(score),
          bestDistance: Math.floor(distance),
          totalGoldCoins: coins.gold,
          totalSilverCoins: coins.silver,
          gamesPlayed: 1,
          gameHistory: [{
            score: Math.floor(score),
            distance: Math.floor(distance),
            goldCoins: coins.gold,
            silverCoins: coins.silver,
            timestamp: new Date()
          }]
        });
      } else {
        if (Math.floor(score) > player.bestScore) {
          player.bestScore = Math.floor(score);
        }

        if (Math.floor(distance) > player.bestDistance) {
          player.bestDistance = Math.floor(distance);
        }

        player.totalGoldCoins += coins.gold;
        player.totalSilverCoins += coins.silver;
        player.gamesPlayed += 1;

        player.gameHistory.push({
          score: Math.floor(score),
          distance: Math.floor(distance),
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
        player.scoreToAverageRatio
        && player.gamesPlayed >= 10
        && player.scoreToAverageRatio >= suspiciousThreshold
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
      await player.save(sessionOpts);

      return {
        bestScore: player.bestScore,
        averageScore: player.averageScore || 0,
        scoreToAverageRatio: player.scoreToAverageRatio || null,
        suspiciousScorePattern: player.suspiciousScorePattern || false,
        bestDistance: player.bestDistance,
        totalGoldCoins: player.totalGoldCoins,
        totalSilverCoins: player.totalSilverCoins,
        gamesPlayed: player.gamesPlayed
      };
    });

    res.json({
      success: true,
      message: 'Result saved successfully with valid signature',
      bestScore: saveOutcome.bestScore,
      averageScore: saveOutcome.averageScore,
      scoreToAverageRatio: saveOutcome.scoreToAverageRatio,
      suspiciousScorePattern: saveOutcome.suspiciousScorePattern,
      bestDistance: saveOutcome.bestDistance,
      totalGoldCoins: saveOutcome.totalGoldCoins,
      totalSilverCoins: saveOutcome.totalSilverCoins,
      gamesPlayed: saveOutcome.gamesPlayed
    });

  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }

    logger.error({ err: error }, 'POST /save error');
    res.status(500).json({ error: 'Server error' });
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
