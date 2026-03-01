const express = require('express');
const router = express.Router();
const Player = require('../models/Player');
const GameResult = require('../models/GameResult');
const { verifySignature, createMessageToVerify } = require('../utils/verifySignature');
const { saveResultLimiter, leaderboardLimiter } = require('../middleware/rateLimiter');

// ✅ GET: Топ 10 игроков (с rate limiting)
router.get('/top', leaderboardLimiter, async (req, res) => {
  try {
    const wallet = req.query.wallet?.toLowerCase();
    
    // ✅ ИСПРАВЛЕНО: добавляем select() для bestScore и bestDistance
    const topPlayers = await Player.find()
      .sort({ bestScore: -1 })
      .limit(10)
      .select('wallet bestScore bestDistance totalGoldCoins totalSilverCoins gamesPlayed');  // ✅ ДОБАВИЛИ bestScore и bestDistance
    
    console.log("📊 TOP 10 Запрос выполнен");
    console.log("📋 Результаты:", topPlayers);
    
    let playerPosition = null;
    if(wallet) {
      const playerData = await Player.findOne({ wallet });
      if(playerData) {
        const position = await Player.countDocuments({
          bestScore: { $gt: playerData.bestScore }
        });
        
        playerPosition = {
          position: position + 1,
          wallet: playerData.wallet,
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
        bestScore: player.bestScore,      // ✅ БЫЛО undefined
        bestDistance: player.bestDistance,  // ✅ БЫЛО undefined
        totalGoldCoins: player.totalGoldCoins,
        totalSilverCoins: player.totalSilverCoins,
        gamesPlayed: player.gamesPlayed
      })),
      playerPosition
    });
    
  } catch(error) {
    console.error('❌ Ошибка GET /top:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ POST: Сохранить результат игры С ВАЛИДАЦИЕЙ ПОДПИС

router.post('/save', saveResultLimiter, async (req, res) => {
  try {
    const { wallet, score, distance, goldCoins, silverCoins, signature, timestamp } = req.body;
    
    if(!wallet || score === undefined || distance === undefined || !signature || !timestamp) {
      return res.status(400).json({ 
        error: 'Missing required fields: wallet, score, distance, signature, timestamp' 
      });
    }
    
    const walletLower = wallet.toLowerCase();
    
    if(typeof score !== 'number' || score < 0 || score > 999999999) {
      return res.status(400).json({ error: 'Invalid score value' });
    }
    
    if(typeof distance !== 'number' || distance < 0 || distance > 999999999) {
      return res.status(400).json({ error: 'Invalid distance value' });
    }
    
    const coins = {
      gold: Math.max(0, Math.min(9999, goldCoins || 0)),
      silver: Math.max(0, Math.min(9999, silverCoins || 0))
    };
    
        // ✅ Замени блок проверки timestamp в POST /save:

    const ts = typeof timestamp === 'number' ? timestamp : parseInt(timestamp, 10);

    if (!ts || isNaN(ts)) {
      return res.status(400).json({ error: 'Invalid timestamp format' });
    }

    const now = Date.now();
    const timeDiff = Math.abs(now - ts);
    const MAX_TIME_DIFF = 10 * 60 * 1000;

    console.log(`⏰ Server time: ${now}`);
    console.log(`⏰ Client timestamp: ${ts}`);
    console.log(`⏰ Difference: ${timeDiff}ms`);

    if (timeDiff > MAX_TIME_DIFF) {
      console.warn(`❌ Timestamp invalid: ${timeDiff}ms`);
      return res.status(400).json({
        error: `Invalid timestamp. Difference: ${timeDiff}ms.`
      });
    }
    
    // ✅ ВЕРИФИКАЦИЯ ПОДПИСИ
    const messageToVerify = createMessageToVerify(
      walletLower, 
      score, 
      distance, 
      timestamp
    );
    
    console.log(`📝 Сообщение для верификации:\n${messageToVerify}`);
    const isSignatureValid = verifySignature(messageToVerify, signature, walletLower);
    
    if(!isSignatureValid) {
      console.warn(`❌ ❌ ❌ НЕВЕРНАЯ ПОДПИСЬ для ${walletLower}`);
      return res.status(401).json({ 
        error: 'Invalid signature. Result cannot be verified.',
        details: 'Your wallet signature does not match the submitted data.'
      });
    }
    
    console.log(`✅ ✅ ✅ Подпись верна для ${walletLower}`);
    
    const existingResult = await GameResult.findOne({ signature });
    if(existingResult) {
      return res.status(400).json({ 
        error: 'This result has already been submitted.' 
      });
    }
    
    // ✅ Сохраняем результат игры в отдельную коллекцию (для аудита)
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
    
    // ✅ ОБНОВЛЯЕМ СТАТИСТИКУ ИГРОКА (НОВАЯ ЛОГИКА)
    let player = await Player.findOne({ wallet: walletLower });
    
    if(!player) {
      // ✅ Новый игрок
      player = new Player({
        wallet: walletLower,
        bestScore: Math.floor(score),        // ✅ Лучший результат
        bestDistance: Math.floor(distance),  // ✅ Лучшая дистанция
        totalGoldCoins: coins.gold,          // ✅ Сумма золотых
        totalSilverCoins: coins.silver,      // ✅ Сумма серебрянных
        gamesPlayed: 1,
        gameHistory: [
          {
            score: Math.floor(score),
            distance: Math.floor(distance),
            goldCoins: coins.gold,
            silverCoins: coins.silver,
            timestamp: new Date()
          }
        ]
      });
    } else {
      // ✅ Существующий игрок - обновляем ТОЛЬКО если лучше
      if(Math.floor(score) > player.bestScore) {
        console.log(`📈 Новый лучший результат: ${Math.floor(score)} (было ${player.bestScore})`);
        player.bestScore = Math.floor(score);
      }
      
      if(Math.floor(distance) > player.bestDistance) {
        console.log(`📈 Новая лучшая дистанция: ${Math.floor(distance)} (было ${player.bestDistance})`);
        player.bestDistance = Math.floor(distance);
      }
      
      // ✅ ВСЕГДА суммируем монеты
      player.totalGoldCoins += coins.gold;
      player.totalSilverCoins += coins.silver;
      player.gamesPlayed += 1;
      
      // ✅ Добавляем в историю
      player.gameHistory.push({
        score: Math.floor(score),
        distance: Math.floor(distance),
        goldCoins: coins.gold,
        silverCoins: coins.silver,
        timestamp: new Date()
      });
      
      // ✅ Храним только последние 100 игр
      if(player.gameHistory.length > 100) {
        player.gameHistory.shift();
      }
    }
    
    player.updatedAt = new Date();
    await player.save();
    
    console.log(`✅ Результат сохранён (ВЕРИФИЦИРОВАН): ${walletLower}`);
    console.log(`   Лучший score: ${player.bestScore}`);
    console.log(`   Лучшая distance: ${player.bestDistance}`);
    console.log(`   Сумма Gold: ${player.totalGoldCoins}`);
    console.log(`   Сумма Silver: ${player.totalSilverCoins}`);
    
    res.json({
      success: true,
      message: 'Result saved successfully with valid signature',
      bestScore: player.bestScore,
      bestDistance: player.bestDistance,
      totalGoldCoins: player.totalGoldCoins,
      totalSilverCoins: player.totalSilverCoins,
      gamesPlayed: player.gamesPlayed
    });
    
  } catch(error) {
    console.error('❌ Ошибка POST /save:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ GET: Проверка верифицированных результатов (для админа/отладки)
router.get('/verified-results/:wallet', async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();
    
    const results = await GameResult.find({ wallet, verified: true })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('score distance goldCoins silverCoins timestamp verified');
    
    res.json({
      wallet,
      count: results.length,
      results
    });
    
  } catch(error) {
    console.error('❌ Ошибка GET /verified-results:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/player/:wallet', leaderboardLimiter, async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();
    
    if(!wallet.match(/^0x[a-f0-9]{40}$/i)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }
    
    const player = await Player.findOne({ wallet });
    
    if(!player) {
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
    
    // ✅ Позиция по ЛУЧШЕМУ результату
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
    
  } catch(error) {
    console.error('❌ Ошибка GET /player:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;









