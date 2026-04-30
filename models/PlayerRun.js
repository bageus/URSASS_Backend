const mongoose = require('mongoose');

const playerRunSchema = new mongoose.Schema({
  playerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Player',
    required: true,
    index: true
  },
  wallet: {
    type: String,
    required: true,
    lowercase: true,
    index: true
  },
  runId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  score: {
    type: Number,
    required: true,
    min: 0
  },
  distance: {
    type: Number,
    required: true,
    min: 0
  },
  goldCoins: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  silverCoins: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  isFirstRun: {
    type: Boolean,
    default: false,
    index: true
  },
  isPersonalBest: {
    type: Boolean,
    default: false
  },
  verified: {
    type: Boolean,
    default: true,
    index: true
  },
  isValid: {
    type: Boolean,
    default: true,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

playerRunSchema.index({ wallet: 1, createdAt: -1 });
playerRunSchema.index({ isFirstRun: 1, score: -1 });
playerRunSchema.index({ isFirstRun: 1, distance: -1 });
playerRunSchema.index({ isFirstRun: 1, goldCoins: -1, silverCoins: -1 });
playerRunSchema.index({ verified: 1, isValid: 1, isFirstRun: 1, score: -1 });
playerRunSchema.index({ verified: 1, isValid: 1, isFirstRun: 1, distance: -1 });
playerRunSchema.index({ verified: 1, isValid: 1, isFirstRun: 1, goldCoins: -1 });

module.exports = mongoose.model('PlayerRun', playerRunSchema);
