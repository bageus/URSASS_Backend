// ✅ GET: Статистика конкретного игрока (или пустая для новых)
router.get('/player/:wallet', leaderboardLimiter, async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();
    
    // ✅ Валидация адреса (примерно проверяем формат)
    if(!wallet.match(/^0x[a-f0-9]{40}$/i)) {
      return res.status(400).json({ error: 'Invalid wallet address format' });
    }
    
    const player = await Player.findOne({ wallet });
    
    // ✅ ИЗМЕНЕНО: Возвращаем 200 даже если игрок новый (не 404)
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
