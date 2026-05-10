const mongoose = require('mongoose');

const onboardingStateSchema = new mongoose.Schema({
  primaryId: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
  flowVersion: { type: String, default: 'v2' },
  mainFlowCompleted: { type: Boolean, default: false },
  mainFlowSkipped: { type: Boolean, default: false },
  currentStep: { type: String, default: 'auth_start' },
  authRunsCount: { type: Number, default: 0, min: 0 },
  rewards: {
    silverAfterSecondRunGranted: { type: Boolean, default: false },
    goldAfterThirdRunGranted: { type: Boolean, default: false }
  },
  storeIntro: {
    shown: { type: Boolean, default: false },
    skipped: { type: Boolean, default: false },
    ridePackBought: { type: Boolean, default: false }
  },
  gifts: {
    radarObstacles: {
      unlocked: { type: Boolean, default: false },
      claimed: { type: Boolean, default: false },
      skipped: { type: Boolean, default: false },
      activeUntil: { type: Date, default: null }
    },
    radarGold: {
      unlocked: { type: Boolean, default: false },
      claimed: { type: Boolean, default: false },
      skipped: { type: Boolean, default: false },
      activeUntil: { type: Date, default: null }
    }
  }
}, { timestamps: true });

module.exports = mongoose.model('OnboardingState', onboardingStateSchema);
