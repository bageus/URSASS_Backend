const mongoose = require('mongoose');

const ANALYTICS_EVENT_TYPES = Object.freeze([
  'app_opened',
  'run_started',
  'run_finished',
  'second_run_started',
  'wallet_connect_success',
  'donation_success',
  'game_start',
  'game_end',
  'session_length',
  'run_duration',
  'upgrade_purchase',
  'currency_spent'
]);

const analyticsEventSchema = new mongoose.Schema({
  eventType: {
    type: String,
    required: true,
    enum: ANALYTICS_EVENT_TYPES,
    index: true
  },
  timestamp: {
    type: Number,
    required: true,
    min: 0,
    index: true
  },
  sentAt: {
    type: Number,
    required: true,
    min: 0,
    index: true
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  receivedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, { minimize: false });

analyticsEventSchema.index({ eventType: 1, timestamp: -1 });

module.exports = {
  AnalyticsEvent: mongoose.model('AnalyticsEvent', analyticsEventSchema),
  ANALYTICS_EVENT_TYPES
};
