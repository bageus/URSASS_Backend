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
    
    const topPlayers = await Player.find()
      .sort({ totalScore: -1 })
      .limit(10)
      .select('wallet totalScore totalDistance totalGoldCoins totalSilverCoins gamesPlayed');
    
    let playerPosition = null;
    if(wallet) {
      const playerData = await Player.findOne({ wallet });
      if(playerData) {
        const position = await Player.countDocuments({
          totalScore: { $gt: playerData.totalScore }
        });
        
        playerPosition = {
          position: position + 1,
          wallet: playerData.wallet,
          totalScore: playerData.totalScore,
          totalDistance: playerData.totalDistance,
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
        totalScore: player.totalScore,
        totalDistance: player.totalDistance,
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

// ✅ POST: Сохранить результат игры С ВАЛИДАЦИЕЙ ПОДПИСИ
router.post('/save', saveResultLimiter, async (req, res) => {
  try {
    const { wallet, score, distance, goldCoins, silverCoins, signature, timestamp } = req.body;
    
    // ✅ Проверяем обязательные поля
    if(!wallet || score === undefined || distance === undefined || !signature || !timestamp) {
      return res.status(400).json({ 
        error: 'Missing required fields: wallet, score, distance, signature, timestamp' 
      });
    }
    
    const walletLower = wallet.toLowerCase();
    
    // ✅ Валидация значений
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
    
    // ✅ Проверка timestamp (не старше 10 минут)
    const now = Date.now();
    const timeDiff = now - timestamp;
    const MAX_TIME_DIFF = 10 * 60 * 1000;
    
    console.log(`⏰ Текущее время (мс): ${now}`);
    console.log(`⏰ Timestamp клиента (мс): ${timestamp}`);
    console.log(`⏰ Разница (мс): ${timeDiff}`);
    
    if(timeDiff < 0 || timeDiff > MAX_TIME_DIFF) {
      console.warn(`❌ Timestamp невалиден: ${timeDiff}мс`);
      return res.status(400).json({ 
        error: `Invalid timestamp. Difference: ${timeDiff}ms. Must be within ${MAX_TIME_DIFF}ms.`
      });
    }
    
    // ✅ ========== ГЛАВНОЕ: ВЕРИФИЦИРУЕМ ПОДПИСЬ ==========
    const messageToVerify = createMessageToVerify(
      walletLower, 
      score, 
      distance, 
      timestamp
    );
    
    console.log(`📝 Сообщение для верификации:\n${messageToVerify}`);
    console.log(`✍️ Подпись: ${signature.substring(0, 20)}...`);
    
    const isSignatureValid = verifySignature(messageToVerify, signature, walletLower);
    
    if(!isSignatureValid) {
      console.warn(`❌ ❌ ❌ НЕВЕРНАЯ ПОДПИСЬ для ${walletLower}`);
      return res.status(401).json({ 
        error: 'Invalid signature. Result cannot be verified.',
        details: 'Your wallet signature does not match the submitted data.'
      });
    }
    
    console.log(`✅ ✅ ✅ Подпись верна для ${walletLower}`);
    // ✅ ========== КОНЕЦ ВЕРИФИКАЦИИ ==========
    
    // ✅ Проверяем дубли по подписи
    const existingResult = await GameResult.findOne({ signature });
    if(existingResult) {
      return res.status(400).json({ 
        error: 'This result has already been submitted.' 
      });
    }
    
    // ✅ Сохраняем результат (теперь верифицирован!)
    const gameResult = new GameResult({
      wallet: walletLower,
      score: Math.floor(score),
      distance: Math.floor(distance),
      goldCoins: coins.gold,
      silverCoins: coins.silver,
      signature,
      timestamp,
      ipAddress: req.ip,
      verified: true  // ✅ Верифицирован!
    });
    
    await gameResult.save();
    
    // ✅ Обновляем статистику игрока
    let player = await Player.findOne({ wallet: walletLower });
    
    if(!player) {
      player = new Player({
        wallet: walletLower,
        totalScore: score,
        totalDistance: distance,
        totalGoldCoins: coins.gold,
        totalSilverCoins: coins.silver,
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
      player.totalScore += Math.floor(score);
      player.totalDistance += Math.floor(distance);
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
      
      // ✅ Храним только последние 100 игр
      if(player.gameHistory.length > 100) {
        player.gameHistory.shift();
      }
    }
    
    player.updatedAt = new Date();
    await player.save();
    
    console.log(`✅ Результат сохранён (ВЕРИФИЦИРОВАН): ${walletLower} | Score: ${score}`);
    
    res.json({
      success: true,
      message: 'Result saved successfully with valid signature',
      totalScore: player.totalScore,
      totalDistance: player.totalDistance,
      gamesPlayed: player.gamesPlayed
    });
    
  } catch(error) {
    console.error('❌ Ошибка POST /save:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ GET: Статистика конкретного игрока (или пустая для новых)
router.get('/player/:wallet', leaderboardLimiter, async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();
    
    // ✅ Валидация адреса (примерно проверяем формат)
    if(!wallet.match(/^0x[a-f0-9]{40}$/i)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }
    
    const player = await Player.findOne({ wallet });
    
    // ✅ Возвращаем 200 даже если игрок новый (не 404)
    if(!player) {
      return res.status(200).json({ 
        wallet: wallet,
        position: null,
        totalScore: 0,
        totalDistance: 0,
        totalGoldCoins: 0,
        totalSilverCoins: 0,
        gamesPlayed: 0,
        gameHistory: [],
        message: 'New player - no previous results'
      });
    }
    
    const position = await Player.countDocuments({
      totalScore: { $gt: player.totalScore }
    });
    
    res.json({
      wallet: player.wallet,
      position: position + 1,
      totalScore: player.totalScore,
      totalDistance: player.totalDistance,
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

module.exports = router;




