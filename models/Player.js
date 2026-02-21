const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  wallet: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    index: true
  },
  
  //累计статистика
  totalScore: {
    type: Number,
    default: 0,
    index: true  // Индекс для быстрой сортировки
  },
  
  totalDistance: {
    type: Number,
    default: 0
  },
  
  totalGoldCoins: {
    type: Number,
    default: 0
  },
  
  totalSilverCoins: {
    type: Number,
    default: 0
  },
  
  gamesPlayed: {
    type: Number,
    default: 0
  },
  
  // История заездов
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
  
  // Общая статистика
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