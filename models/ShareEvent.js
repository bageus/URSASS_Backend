const mongoose = require('mongoose');

const shareEventSchema = new mongoose.Schema({
  primaryId: { type: String, index: true },
  wallet: { type: String, sparse: true },
  shareId: { type: String, unique: true, index: true },
  startedAt: { type: Date },
  confirmedAt: { type: Date, default: null },
  rewardedAt: { type: Date, default: null },
  goldAwarded: { type: Number, default: 0 },
  dayKey: { type: String, index: true },
  scoreAtShare: { type: Number },
  postText: { type: String },
  imageUrl: { type: String },

  // Future: X post verification
  tweetId: { type: String, default: null },
  verifiedAt: { type: Date, default: null }
});

shareEventSchema.index({ primaryId: 1, dayKey: 1 });
shareEventSchema.index({ shareId: 1 });

module.exports = mongoose.model('ShareEvent', shareEventSchema);
