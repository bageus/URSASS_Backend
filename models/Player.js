
const mongoose = require('mongoose');
const { generateReferralCode } = require('../utils/referral');

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

  averageScore: {
    type: Number,
    default: 0
  },

  scoreToAverageRatio: {
    type: Number,
    default: null
  },

  suspiciousScorePattern: {
    type: Boolean,
    default: false
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
  
  // Referral system
  referralCode: { type: String, unique: true, sparse: true, index: true },
  referredBy: { type: String, default: null, index: true },
  referralRewardGranted: { type: Boolean, default: false },

  // X (Twitter) OAuth stubs — real integration in PR-2
  xUserId: { type: String, default: null, index: true, sparse: true },
  xUsername: { type: String, default: null },
  xAccessToken: { type: String, default: null, select: false },
  xRefreshToken: { type: String, default: null, select: false },
  xConnectedAt: { type: Date, default: null },

  // Reward gold balance (from referrals, daily share, etc.)
  gold: { type: Number, default: 0 },

  // Share streak
  shareStreak: { type: Number, default: 0 },
  lastShareDay: { type: String, default: null },
  lastShareAt: { type: Date, default: null },

  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

const MAX_CODE_ATTEMPTS = 5;

playerSchema.pre('save', async function generateReferralCodeHook(next) {
  if (this.referralCode) {
    return next();
  }

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateReferralCode();
    const exists = await mongoose.model('Player').findOne({ referralCode: code }).lean();
    if (!exists) {
      this.referralCode = code;
      return next();
    }
  }

  return next(new Error('Failed to generate unique referral code after max attempts'));
});

module.exports = mongoose.model('Player', playerSchema);
