const mongoose = require('mongoose');

const leaderboardAggregateSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  refreshedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

module.exports = mongoose.model('LeaderboardAggregate', leaderboardAggregateSchema);
