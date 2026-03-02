const mongoose = require('mongoose');

/**
 * Связка между Telegram ID и Wallet адресом.
 * Один Telegram ID ↔ один Wallet (1:1).
 */
const accountLinkSchema = new mongoose.Schema({
  // Telegram ID (число, уникальный)
  telegramId: {
    type: String,
    default: null,
    sparse: true,
    index: true
  },

  // Wallet адрес (lowercase, уникальный)
  wallet: {
    type: String,
    default: null,
    sparse: true,
    lowercase: true,
    index: true
  },

  // Основной идентификатор игрока (используется в Player, PlayerUpgrades и т.д.)
  // Формат: "tg_123456789" или "0x1234...abcd"
  primaryId: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    index: true
  },

  // Какой аккаунт был "мастером" при мердже
  masterSource: {
    type: String,
    enum: ['telegram', 'wallet', null],
    default: null
  },

  // Когда произошла привязка
  linkedAt: {
    type: Date,
    default: null
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

// Уникальные индексы (sparse — позволяют null)
accountLinkSchema.index({ telegramId: 1 }, { unique: true, sparse: true });
accountLinkSchema.index({ wallet: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('AccountLink', accountLinkSchema);
