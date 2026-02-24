
const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  wallet: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    index: true
  },
  
  // ✅ ЛУЧШИЙ результат (не сумма!)
  bestScore: {
    type: Number,
    default: 0,
    index: true
  },
  
  bestDistance: {
    type: Number,
    default: 0
  },
  
  // ✅ СУММА собранных монет
  totalGoldCoins: {
    type: Number,
    default: 0
  },
  
  totalSilverCoins: {
    type: Number,
    default: 0
  },
  
  // ✅ Количество сыгранных игр
  gamesPlayed: {
    type: Number,
    default: 0
  },
  
  // ✅ История последних 100 игр (для статистики)
  gameHistory: [
    {
      score: Number,
      distance: Number,
      goldCoins: Number,
      silverCoins: Number,
      timestamp: {
        type: Date,
        default: Date.now
      }
    }
  ],
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Player', playerSchema);

