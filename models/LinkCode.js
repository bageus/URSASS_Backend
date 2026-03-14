const mongoose = require('mongoose');

const linkCodeSchema = new mongoose.Schema({
  // Wallet или primaryId того, кто запросил привязку
  primaryId: {
    type: String,
    required: true,
    lowercase: true,
    index: true
  },

  // Проверочный код (например "BEAR-A3F9K2")
  code: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // Тип привязки: "telegram" (wallet→tg) или "wallet" (tg→wallet)
  linkType: {
    type: String,
    enum: ['telegram', 'wallet'],
    required: true
  },

  // Использован ли код
  used: {
    type: Boolean,
    default: false
  },

  // Когда создан
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 600 // TTL: автоудаление через 10 минут
  },

  // Когда истекает
  expiresAt: {
    type: Date,
    required: true
  }
});

module.exports = mongoose.model('LinkCode', linkCodeSchema);
