const mongoose = require('mongoose');

const securityEventSchema = new mongoose.Schema({
  wallet: {
    type: String,
    default: null,
    lowercase: true,
    index: true
  },
  eventType: {
    type: String,
    required: true,
    index: true
  },
  route: {
    type: String,
    default: null
  },
  ipAddress: {
    type: String,
    default: null,
    index: true
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

securityEventSchema.index({ eventType: 1, createdAt: -1 });
securityEventSchema.index({ wallet: 1, eventType: 1, createdAt: -1 });

module.exports = mongoose.model('SecurityEvent', securityEventSchema);
