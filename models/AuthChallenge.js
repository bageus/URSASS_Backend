const mongoose = require('mongoose');

const authChallengeSchema = new mongoose.Schema({
  tokenHash: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    index: true
  },
  primaryId: {
    type: String,
    default: null,
    lowercase: true,
    index: true
  },
  telegramId: {
    type: String,
    default: null,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  used: {
    type: Boolean,
    default: false,
    index: true
  },
  usedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

authChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AuthChallenge', authChallengeSchema);
