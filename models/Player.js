
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
  
  // ── Referral system ───────────────────────────────────────────────────────
  referralCode: { type: String, unique: true, sparse: true, index: true },
  referredBy: { type: String, default: null, index: true },
  referralRewardGranted: { type: Boolean, default: false },

  // ── X (Twitter) OAuth — stubs for PR-2 ───────────────────────────────────
  xUserId: { type: String, default: null, index: true, sparse: true },
  xUsername: { type: String, default: null },
  xAccessToken: { type: String, default: null, select: false },
  xRefreshToken: { type: String, default: null, select: false },
  xConnectedAt: { type: Date, default: null },

  // ── Gold reward wallet (share/referral rewards; separate from in-game coins)
  gold: { type: Number, default: 0 },

  // ── Daily share streak ────────────────────────────────────────────────────
  shareStreak: { type: Number, default: 0 },
  lastShareDay: { type: String, default: null },
  lastShareAt: { type: Date, default: null },

  // ── Rank tracking (for rankDelta in profile) ──────────────────────────────
  lastSeenRank: { type: Number, default: null },

  // ── Player display settings ───────────────────────────────────────────────
  nickname: { type: String, default: null, maxlength: 16 },
  nicknameLower: {
    type: String,
    default: null,
    lowercase: true,
    sparse: true,
    index: { unique: true, sparse: true }
  },
  leaderboardDisplay: {
    type: String,
    enum: ['nickname', 'wallet', 'telegram'],
    default: 'wallet'
  },

  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Generate a unique referralCode before first save if not already set.
playerSchema.pre('save', async function generateCode() {
  if (this.referralCode) return;

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateReferralCode();
    const exists = await this.constructor.findOne({ referralCode: code }).select('_id').lean();
    if (!exists) {
      this.referralCode = code;
      return;
    }
  }

  // Extremely unlikely but surface the error clearly
  throw new Error('Could not generate a unique referral code after 5 attempts');
});

module.exports = mongoose.model('Player', playerSchema);
