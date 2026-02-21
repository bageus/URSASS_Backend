const express = require('express');
const router = express.Router();
const Player = require('../models/Player');

// ✅ GET: Топ 10 игроков + позиция текущего пользователя
router.get('/top', async (req, res) => {
  try {
    const wallet = req.query.wallet?.toLowerCase();
    
    // Получаем топ 10
    const topPlayers = await Player.find()
      .sort({ totalScore: -1 })
      .limit(10)
      .select('wallet totalScore totalDistance totalGoldCoins totalSilverCoins gamesPlayed');
    
    // Если передан кошелёк - получаем его позицию
    let playerPosition = null;
    if(wallet) {
      const playerData = await Player.findOne({ wallet });
      if(playerData) {
        // Считаем сколько игроков впереди
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

// ✅ POST: Сохранить результат игры
router.post('/save', async (req, res) => {
  try {
    const { wallet, score, distance, goldCoins, silverCoins, signature } = req.body;
    
    if(!wallet || score === undefined || distance === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const walletLower = wallet.toLowerCase();
    
    // Ищем или создаём игрока
    let player = await Player.findOne({ wallet: walletLower });
    
    if(!player) {
      player = new Player({
        wallet: walletLower,
        totalScore: score,
        totalDistance: distance,
        totalGoldCoins: goldCoins || 0,
        totalSilverCoins: silverCoins || 0,
        gamesPlayed: 1,
        gameHistory: [
          {
            score,
            distance,
            goldCoins: goldCoins || 0,
            silverCoins: silverCoins || 0
          }
        ]
      });
    } else {
      // Обновляем累计статистику
      player.totalScore += score;
      player.totalDistance += distance;
      player.totalGoldCoins += goldCoins || 0;
      player.totalSilverCoins += silverCoins || 0;
      player.gamesPlayed += 1;
      
      // Добавляем в историю
      player.gameHistory.push({
        score,
        distance,
        goldCoins: goldCoins || 0,
        silverCoins: silverCoins || 0
      });
      
      // Ограничиваем историю последними 100 игр
      if(player.gameHistory.length > 100) {
        player.gameHistory.shift();
      }
    }
    
    player.updatedAt = new Date();
    await player.save();
    
    console.log(`✅ Результат сохранён: ${walletLower} | Score: ${score}`);
    
    res.json({
      success: true,
      totalScore: player.totalScore,
      totalDistance: player.totalDistance,
      gamesPlayed: player.gamesPlayed
    });
    
  } catch(error) {
    console.error('❌ Ошибка POST /save:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ✅ GET: Статистика конкретного игрока
router.get('/player/:wallet', async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();
    
    const player = await Player.findOne({ wallet });
    
    if(!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Получаем позицию
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

module.exports = router;