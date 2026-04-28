const mongoose = require('mongoose');

const COIN_TRANSACTION_TYPES = ['share', 'ride', 'buy', 'referral', 'refer', 'task'];

const coinTransactionSchema = new mongoose.Schema({
  primaryId: { type: String, required: true, index: true, trim: true, lowercase: true },
  type: { type: String, required: true, enum: COIN_TRANSACTION_TYPES },
  gold: { type: Number, required: true, min: 0, default: 0 },
  silver: { type: Number, required: true, min: 0, default: 0 },
  createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

coinTransactionSchema.index({ primaryId: 1, createdAt: -1 });

coinTransactionSchema.pre('validate', function(next) {
  if ((this.gold || 0) <= 0 && (this.silver || 0) <= 0) {
    next(new Error('CoinTransaction requires positive gold or silver amount'));
    return;
  }
  next();
});

module.exports = mongoose.models.CoinTransaction || mongoose.model('CoinTransaction', coinTransactionSchema);
module.exports.COIN_TRANSACTION_TYPES = COIN_TRANSACTION_TYPES;
