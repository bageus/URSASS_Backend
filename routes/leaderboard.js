const express = require('express');
const router = express.Router();
const Player = require('../models/Player');
const GameResult = require('../models/GameResult');
const AccountLink = require('../models/AccountLink');
const { verifySignature, createMessageToVerify } = require('../utils/verifySignature');
const { saveResultLimiter, leaderboardLimiter } = require('../middleware/rateLimiter');

/**
 * Build display name for a player based on their AccountLink data.
 * Priority:
 *   1. If wallet is linked → show wallet address (shortened)
 *   2. If only telegram → show "TG#id"
 *   3. Fallback → show primaryId (shortened if wallet-like)
 */
function buildDisplayName(link, primaryId) {
  if (!link) {
    // No link found — show primaryId as-is
    if (primaryId && primaryId.startsWith('0x')) {
      return `${primaryId.slice(0, 6)}...${primaryId.slice(-4)}`;
    }
    return primaryId || 'Unknown';
  }

  // If wallet is linked — always show wallet
  if (link.wallet) {
    return `${link.wallet.slice(0, 6)}...${link.wallet.slice(-4)}`;
  }

  // Only telegram — show TG#id
  if (link.telegramId) {
    return `TG#${link.telegramId}`;
  }

  // Fallback
  if (primaryId && primaryId.startsWith('0x')) {
    return `${primaryId.slice(0, 6)}...${primaryId.slice(-4)}`;
  }
  return primaryId || 'Unknown';
}

// ✅ GET: Top 10 players
router.get('/top', leaderboardLimiter, async (req, res) => {
  try {
    const wallet = req.query.wallet?.toLowerCase();

    const topPlayers = await Player.find()
      .sort({ bestScore: -1 })
      .limit(10)
      .select('wallet bestScore bestDistance totalGoldCoins totalSilverCoins gamesPlayed');

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
        const position = await Player.countDocuments({
          bestScore: { $gt: playerData.bestScore }
        });

        const playerLink = await AccountLink.findOne({ primaryId: wallet });

        playerPosition = {
          position: position + 1,
          wallet: playerData.wallet,
          displayName: buildDisplayName(playerLink, playerData.wallet),
          bestScore: playerData.bestScore,
          bestDistance: playerData.bestDistance,
          totalGoldCoins: playerData.totalGoldCoins,
          totalSilverCoins: playerData.totalSilverCoins,
          gamesPlayed: playerData.gamesPlayed
        };
      }
    }

    res.json({
      leaderboard: topPlayers.map((player, index) => ({
        position: index + 1,
        wallet: player.wallet,
        displayName: buildDisplayName(linkMap[player.wallet], player.wallet),
        bestScore: player.bestScore,
        bestDistance: player.bestDistance,
        totalGoldCoins: player.totalGoldCoins,
        totalSilverCoins: player.totalSilverCoins,
        gamesPlayed: player.gamesPlayed
      })),
      playerPosition
    });

  } catch (error) {
    console.error('❌ GET /top error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ POST: Save game result with signature verification
router.post('/save', saveResultLimiter, async (req, res) => {
  try {
    const { wallet, score, distance, goldCoins, silverCoins, signature, timestamp } = req.body;

    if (!wallet || score === undefined || distance === undefined || !signature || !timestamp) {
      return res.status(400).json({
        error: 'Missing required fields: wallet, score, distance, signature, timestamp'
      });
    }

    const walletLower = wallet.toLowerCase();

    if (typeof score !== 'number' || score < 0 || score > 999999999) {
      return res.status(400).json({ error: 'Invalid score value' });
    }

    if (typeof distance !== 'number' || distance < 0 || distance > 999999999) {
      return res.status(400).json({ error: 'Invalid distance value' });
    }

    const coins = {
      gold: Math.max(0, Math.min(9999, goldCoins || 0)),
      silver: Math.max(0, Math.min(9999, silverCoins || 0))
    };

    const ts = typeof timestamp === 'number' ? timestamp : parseInt(timestamp, 10);

    if (!ts || isNaN(ts)) {
      return res.status(400).json({ error: 'Invalid timestamp format' });
    }

    const now = Date.now();
    const timeDiff = Math.abs(now - ts);
    const MAX_TIME_DIFF = 10 * 60 * 1000;

    console.log(`⏰ Server time: ${now}, Client timestamp: ${ts}, Difference: ${timeDiff}ms`);

    if (timeDiff > MAX_TIME_DIFF) {
      console.warn(`❌ Timestamp invalid: ${timeDiff}ms`);
      return res.status(400).json({
        error: `Invalid timestamp. Difference: ${timeDiff}ms.`
      });
    }

    // Signature verification
    const messageToVerify = createMessageToVerify(walletLower, score, distance, timestamp);

    console.log(`📝 Message for verification:\n${messageToVerify}`);
    const isSignatureValid = verifySignature(messageToVerify, signature, walletLower);

    if (!isSignatureValid) {
      console.warn(`❌ Invalid signature for ${walletLower}`);
      return res.status(401).json({
        error: 'Invalid signature. Result cannot be verified.',
        details: 'Your wallet signature does not match the submitted data.'
      });
    }

    console.log(`✅ Signature valid for ${walletLower}`);

    const existingResult = await GameResult.findOne({ signature });
    if (existingResult) {
      return res.status(400).json({
        error: 'This result has already been submitted.'
      });
    }

    // Save game result
    const gameResult = new GameResult({
      wallet: walletLower,
      score: Math.floor(score),
      distance: Math.floor(distance),
      goldCoins: coins.gold,
      silverCoins: coins.silver,
      signature,
      timestamp,
      ipAddress: req.ip,
      verified: true
    });

    await gameResult.save();

    // Update player stats
    let player = await Player.findOne({ wallet: walletLower });

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
        console.log(`📈 New best score: ${Math.floor(score)} (was ${player.bestScore})`);
        player.bestScore = Math.floor(score);
      }

      if (Math.floor(distance) > player.bestDistance) {
        console.log(`📈 New best distance: ${Math.floor(distance)} (was ${player.bestDistance})`);
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

    player.updatedAt = new Date();
    await player.save();

    console.log(`✅ Result saved (VERIFIED): ${walletLower}`);
    console.log(`   Best score: ${player.bestScore}, Best distance: ${player.bestDistance}`);
    console.log(`   Total Gold: ${player.totalGoldCoins}, Total Silver: ${player.totalSilverCoins}`);

    res.json({
      success: true,
      message: 'Result saved successfully with valid signature',
      bestScore: player.bestScore,
      bestDistance: player.bestDistance,
      totalGoldCoins: player.totalGoldCoins,
      totalSilverCoins: player.totalSilverCoins,
      gamesPlayed: player.gamesPlayed
    });

  } catch (error) {
    console.error('❌ POST /save error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ GET: Verified results for a wallet
router.get('/verified-results/:wallet', async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();

    const results = await GameResult.find({ wallet, verified: true })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('score distance goldCoins silverCoins timestamp verified');

    res.json({ wallet, count: results.length, results });

  } catch (error) {
    console.error('❌ GET /verified-results error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ GET: Player info
router.get('/player/:wallet', leaderboardLimiter, async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();

    // Accept both wallet addresses and tg_ prefixed IDs
    const player = await Player.findOne({ wallet });

    if (!player) {
      return res.status(200).json({
        wallet: wallet,
        position: null,
        bestScore: 0,
        bestDistance: 0,
        totalGoldCoins: 0,
        totalSilverCoins: 0,
        gamesPlayed: 0,
        gameHistory: [],
        message: 'New player - no previous results'
      });
    }

    const position = await Player.countDocuments({
      bestScore: { $gt: player.bestScore }
    });

    res.json({
      wallet: player.wallet,
      position: position + 1,
      bestScore: player.bestScore,
      bestDistance: player.bestDistance,
      totalGoldCoins: player.totalGoldCoins,
      totalSilverCoins: player.totalSilverCoins,
      gamesPlayed: player.gamesPlayed,
      gameHistory: player.gameHistory.slice(-10).reverse()
    });

  } catch (error) {
    console.error('❌ GET /player error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
