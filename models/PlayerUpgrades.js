const mongoose = require('mongoose');

const playerUpgradesSchema = new mongoose.Schema({
  wallet: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    index: true
  },

  // === SILVER (3 тира каждый) ===
  x2_duration: { type: Number, default: 0, min: 0, max: 3 },
  score_plus_mult: { type: Number, default: 0, min: 0, max: 3 },
  score_minus_mult: { type: Number, default: 0, min: 0, max: 3 },
  invert_score: { type: Number, default: 0, min: 0, max: 3 },
  speed_up_mult: { type: Number, default: 0, min: 0, max: 3 },
  speed_down_mult: { type: Number, default: 0, min: 0, max: 3 },
  magnet_duration: { type: Number, default: 0, min: 0, max: 3 },
  spin_cooldown: { type: Number, default: 0, min: 0, max: 3 },

  // === GOLD (перманентные/consumable) ===
  shield: { type: Number, default: 0, min: 0, max: 1 },

  // === СИСТЕМА ЗАЕЗДОВ ===

  // Бесплатные заезды (восстанавливаются раз в 8 часов)
  freeRidesRemaining: {
    type: Number,
    default: 3,
    min: 0,
    max: 3
  },

  // Когда последний раз обновились бесплатные заезды
  freeRidesResetAt: {
    type: Date,
    default: Date.now
  },

  // Купленные заезды (не сгорают, не восстанавливаются)
  paidRidesRemaining: {
    type: Number,
    default: 0,
    min: 0
  },

  updatedAt: {
    type: Date,
    default: Date.now
  }
});

/**
 * Пересчитать бесплатные заезды на основе времени.
 * Вызывается при каждом обращении к данным игрока.
 * Возвращает true если были изменения.
 */
playerUpgradesSchema.methods.refreshFreeRides = function() {
  const now = new Date();
  const resetAt = this.freeRidesResetAt || new Date(0);
  const hoursSinceReset = (now - resetAt) / (1000 * 60 * 60);

  // Если прошло 8+ часов и заезды не полные — восстанавливаем
  if (hoursSinceReset >= 8 && this.freeRidesRemaining < 3) {
    this.freeRidesRemaining = 3;
    this.freeRidesResetAt = now;
    return true;
  }

  // Если заезды полные — обновляем таймер (чтобы отсчёт шёл от последнего полного состояния)
  if (this.freeRidesRemaining >= 3) {
    this.freeRidesResetAt = now;
  }

  return false;
};

/**
 * Получить общее количество доступных заездов
 */
playerUpgradesSchema.methods.getTotalRides = function() {
  return this.freeRidesRemaining + this.paidRidesRemaining;
};

/**
 * Потратить 1 заезд. Сначала бесплатные, потом платные.
 * Возвращает true если успешно.
 */
playerUpgradesSchema.methods.consumeRide = function() {
  if (this.freeRidesRemaining > 0) {
    this.freeRidesRemaining--;

    // Если это первый потраченный бесплатный заезд — фиксируем время для таймера
    if (this.freeRidesRemaining < 3) {
      // freeRidesResetAt уже установлен, не трогаем
    }

    return true;
  }

  if (this.paidRidesRemaining > 0) {
    this.paidRidesRemaining--;
    return true;
  }

  return false;
};

module.exports = mongoose.model('PlayerUpgrades', playerUpgradesSchema);
