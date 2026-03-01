const mongoose = require('mongoose');

/**
 * Все улучшения игрока.
 * Каждое поле — текущий купленный уровень (0 = не куплено, 1/2/3 = тиры).
 * Для одноразовых (shield, spin_recharge) — 0 или 1.
 */
const playerUpgradesSchema = new mongoose.Schema({
  wallet: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    index: true
  },

  // === SILVER (3 тира каждый) ===

  // X2 Score — длительность: базовая 7с → +5/+5/+5 = 12/17/22
  x2_duration: {
    type: Number,
    default: 0,
    min: 0,
    max: 3
  },

  // Score +300/500 — множитель: x1 → x1.5/x1.7/x2
  score_plus_mult: {
    type: Number,
    default: 0,
    min: 0,
    max: 3
  },

  // Score -300/500 — множитель штрафа: x1 → x0.9/x0.7/x0.5
  score_minus_mult: {
    type: Number,
    default: 0,
    min: 0,
    max: 3
  },

  // Invert — очки во время инверта: x1 → x1.5/x1.7/x2
  invert_score: {
    type: Number,
    default: 0,
    min: 0,
    max: 3
  },

  // Speed Up — коэффициент ускорения: x1 → x2/x3/x4
  speed_up_mult: {
    type: Number,
    default: 0,
    min: 0,
    max: 3
  },

  // Speed Down — коэффициент замедления: x1 → x2/x3/x4
  speed_down_mult: {
    type: Number,
    default: 0,
    min: 0,
    max: 3
  },

  // Magnet — длительность: базовая 7с → +5/+5/+5 = 12/17/22
  magnet_duration: {
    type: Number,
    default: 0,
    min: 0,
    max: 3
  },

  // Spin recharge — кулдаун спина: базовый 30с → -2/-3/-5 = 28/25/20
  spin_cooldown: {
    type: Number,
    default: 0,
    min: 0,
    max: 3
  },

  // === GOLD (одноразовые, покупаются каждый раз) ===

  // Shield — старт со щитом (1 = куплен на следующую игру, 0 = нет)
  shield: {
    type: Number,
    default: 0,
    min: 0,
    max: 1
  },

  // Rides pack — пак 3 заезда (будущее)
  rides_pack: {
    type: Number,
    default: 0,
    min: 0,
    max: 99
  },

  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('PlayerUpgrades', playerUpgradesSchema);
