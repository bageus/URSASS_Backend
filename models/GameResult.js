const mongoose = require('mongoose');

const gameResultSchema = new mongoose.Schema({
  wallet: {
    type: String,
    required: true,
    lowercase: true,
    index: true
  },
  
  score: {
    type: Number,
    required: true,
    min: 0,
    max: 999999999
  },
  
  distance: {
    type: Number,
    required: true,
    min: 0,
    max: 999999999
  },
  
  goldCoins: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
    max: 9999
  },
  
  silverCoins: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
    max: 9999
  },
  
  // ✅ EIP-191 подпись для верификации
  signature: {
    type: String,
    required: true
  },
  
  // ✅ Timestamp из фронтенда (для защиты от старых результатов)
  timestamp: {
    type: Number,
    required: true
  },
  
  // ✅ IP адрес для дополнительной защиты
  ipAddress: {
    type: String,
    default: null
  },
  
  // ✅ Статус верификации
  verified: {
    type: Boolean,
    default: false,
    index: true
  },
  
  // ✅ Время создания на сервере
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// ✅ Индекс для предотвращения дублей за короткий промежуток времени
gameResultSchema.index({ wallet: 1, timestamp: 1 }, { unique: true });

module.exports = mongoose.model('GameResult', gameResultSchema);
