const mongoose = require('mongoose');

const referralRewardSchema = new mongoose.Schema({
  referredPrimaryId: { type: String, required: true, unique: true, index: true },
  referrerPrimaryId: { type: String, required: true, index: true },
  referralCode: { type: String, required: true, index: true },
  referredGoldAwarded: { type: Number, default: 100 },
  referrerGoldAwarded: { type: Number, default: 50 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ReferralReward', referralRewardSchema);
