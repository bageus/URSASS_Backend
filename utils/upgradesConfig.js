/**
 * Конфигурация всех улучшений.
 *
 * type: "tiered" — 3 тира, покупаются последовательно
 * type: "consumable" — одноразовый, покупается перед каждой игрой
 *
 * currency: "silver" | "gold"
 * prices: массив цен за каждый тир
 * effects: что даёт каждый тир
 */

const UPGRADES_CONFIG = {

  // === SILVER — TIERED ===

  x2_duration: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [100, 100, 100],
    effects: [5, 10, 15],           // +секунд к базовым 7с
    description: "X2 Score duration"
  },

  score_plus_mult: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [100, 100, 100],
    effects: [1.5, 1.7, 2.0],      // множитель очков бонуса +300/500
    description: "Score +300/500 multiplier"
  },

  score_minus_mult: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [100, 100, 100],
    effects: [0.9, 0.7, 0.5],      // множитель штрафа -300/500
    description: "Score -300/500 reduction"
  },

  invert_score: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [100, 100, 100],
    effects: [1.5, 1.7, 2.0],      // множитель очков при инверте
    description: "Invert score multiplier"
  },

  speed_up_mult: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [100, 100, 100],
    effects: [2, 3, 4],            // коэффициент ускорения
    description: "Speed Up multiplier"
  },

  speed_down_mult: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [100, 100, 100],
    effects: [2, 3, 4],            // коэффициент замедления
    description: "Speed Down multiplier"
  },

  magnet_duration: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [100, 100, 100],
    effects: [5, 10, 15],          // +секунд к базовым 7с
    description: "Magnet duration"
  },

  spin_cooldown: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [100, 100, 100],
    effects: [2, 3, 5],            // -секунд от базового кулдауна 30с
    description: "Spin cooldown reduction"
  },

  // === GOLD — CONSUMABLE ===

    shield: {
    type: "consumable",
    currency: "gold",
    maxLevel: 1,
    prices: [10],
    effects: [true],
    description: "Start with shield (permanent)"
  },

  rides_pack: {
    type: "consumable",
    currency: "gold",
    maxLevel: 1,
    prices: [10],
    effects: [3],                  // 3 заезда
    description: "3 rides pack (future)"
  }
};

/**
 * Рассчитать финальные значения эффектов игрока на основе его апгрейдов
 */
function calculateEffects(upgrades) {
  return {
    // X2 длительность: базовая 7 + бонус
    x2_duration_bonus: upgrades.x2_duration > 0
      ? UPGRADES_CONFIG.x2_duration.effects[upgrades.x2_duration - 1]
      : 0,

    // Score +300/500 множитель
    score_plus_multiplier: upgrades.score_plus_mult > 0
      ? UPGRADES_CONFIG.score_plus_mult.effects[upgrades.score_plus_mult - 1]
      : 1.0,

    // Score -300/500 множитель (чем меньше — тем лучше для игрока)
    score_minus_multiplier: upgrades.score_minus_mult > 0
      ? UPGRADES_CONFIG.score_minus_mult.effects[upgrades.score_minus_mult - 1]
      : 1.0,

    // Invert score множитель
    invert_score_multiplier: upgrades.invert_score > 0
      ? UPGRADES_CONFIG.invert_score.effects[upgrades.invert_score - 1]
      : 1.0,

    // Speed Up коэффициент
    speed_up_multiplier: upgrades.speed_up_mult > 0
      ? UPGRADES_CONFIG.speed_up_mult.effects[upgrades.speed_up_mult - 1]
      : 1.0,

    // Speed Down коэффициент
    speed_down_multiplier: upgrades.speed_down_mult > 0
      ? UPGRADES_CONFIG.speed_down_mult.effects[upgrades.speed_down_mult - 1]
      : 1.0,

    // Magnet длительность: базовая 7 + бонус
    magnet_duration_bonus: upgrades.magnet_duration > 0
      ? UPGRADES_CONFIG.magnet_duration.effects[upgrades.magnet_duration - 1]
      : 0,

    // Spin cooldown сокращение (в секундах)
    spin_cooldown_reduction: upgrades.spin_cooldown > 0
      ? UPGRADES_CONFIG.spin_cooldown.effects[upgrades.spin_cooldown - 1]
      : 0,

    // Shield на старте
    start_with_shield: upgrades.shield > 0,

    // Rides pack
    rides_remaining: upgrades.rides_pack || 0
  };
}

module.exports = {
  UPGRADES_CONFIG,
  calculateEffects
};
