const mongoose = require('mongoose');

const donationPaymentSchema = new mongoose.Schema({
  paymentId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  wallet: {
    type: String,
    required: true,
    lowercase: true,
    index: true
  },
  productKey: {
    type: String,
    required: true,
    index: true
  },
  productSnapshot: {
    type: Object,
    required: true
  },
  status: {
    type: String,
    enum: ['awaiting_tx', 'submitted', 'confirmed', 'credited', 'failed', 'expired'],
    default: 'awaiting_tx',
    index: true
  },
  network: {
    type: String,
    required: true
  },
  tokenSymbol: {
    type: String,
    required: true
  },
  tokenContract: {
    type: String,
    required: true,
    lowercase: true
  },
  merchantWallet: {
    type: String,
    required: true,
    lowercase: true
  },
  expectedAmount: {
    type: String,
    required: true
  },
  expectedDecimals: {
    type: Number,
    required: true
  },
  txHash: {
    type: String,
    default: null,
    sparse: true,
    unique: true,
    index: true
  },
  txFrom: {
    type: String,
    default: null
  },
  txTo: {
    type: String,
    default: null
  },
  txAmount: {
    type: String,
    default: null
  },
  confirmations: {
    type: Number,
    default: 0
  },
  failureReason: {
    type: String,
    default: null
  },
  expiresAt: {
    type: Date,
    default: null,
    index: true
  },
  submittedAt: {
    type: Date,
    default: null
  },
  confirmedAt: {
    type: Date,
    default: null
  },
  creditedAt: {
    type: Date,
    default: null
  },
  rewardGrantedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

donationPaymentSchema.index({ wallet: 1, createdAt: -1 });
donationPaymentSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model('DonationPayment', donationPaymentSchema);
