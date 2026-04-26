const mongoose = require('mongoose');

const shareEventSchema = new mongoose.Schema({
  primaryId: { type: String, index: true },
  wallet: { type: String, default: null, sparse: true },
  shareId: { type: String, unique: true, index: true },
  startedAt: { type: Date, default: null },
  confirmedAt: { type: Date, default: null },
  rewardedAt: { type: Date, default: null },
  goldAwarded: { type: Number, default: 0 },
  dayKey: { type: String, index: true, default: null },
  scoreAtShare: { type: Number, default: 0 },
  postText: { type: String, default: null },
  imageUrl: { type: String, default: null },
  tweetId: { type: String, default: null },
  verifiedAt: { type: Date, default: null }
});

shareEventSchema.index({ primaryId: 1, dayKey: 1 });
shareEventSchema.index({ shareId: 1 });

module.exports = mongoose.model('ShareEvent', shareEventSchema);
