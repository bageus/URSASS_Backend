const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
  wallet: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    index: true
  },
  
  totalScore: {
    type: Number,
    default: 0,
    index: true
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
