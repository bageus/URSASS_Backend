const mongoose = require('mongoose');

const COIN_TRANSACTION_TYPES = [
  'share',
  'ride',
  'race_reward',
  'bonus_reward',
  'buy',
  'referral',
  'refer',
  'task',
  'onboarding_bonus',
  'share_reward',
  'referral_bonus',
  'onboarding',
  'game_reward',
  'store_purchase',
  'upgrade_purchase',
  'purchase_spend',
  'spend',
  'cost'
];
const ONBOARDING_BONUS_REASONS = ['second_race_bonus', 'third_race_bonus'];

const coinTransactionSchema = new mongoose.Schema({
  primaryId: { type: String, required: true, index: true, trim: true, lowercase: true },
  type: { type: String, required: true, enum: COIN_TRANSACTION_TYPES },
  contextKey: { type: String, default: null, index: true },
  reason: { type: String, default: null, enum: [...ONBOARDING_BONUS_REASONS, null] },
  gold: { type: Number, required: true, min: 0, default: 0 },
  silver: { type: Number, required: true, min: 0, default: 0 },
  direction: { type: String, enum: ['income', 'spending'], default: 'income', index: true },
  createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

coinTransactionSchema.index({ primaryId: 1, createdAt: -1 });
coinTransactionSchema.index({ contextKey: 1 }, { unique: true, sparse: true });

coinTransactionSchema.pre('validate', function(next) {
  if ((this.gold || 0) <= 0 && (this.silver || 0) <= 0) {
    next(new Error('CoinTransaction requires positive gold or silver amount'));
    return;
  }
  next();
});

module.exports = mongoose.models.CoinTransaction || mongoose.model('CoinTransaction', coinTransactionSchema);
module.exports.COIN_TRANSACTION_TYPES = COIN_TRANSACTION_TYPES;
module.exports.ONBOARDING_BONUS_REASONS = ONBOARDING_BONUS_REASONS;
