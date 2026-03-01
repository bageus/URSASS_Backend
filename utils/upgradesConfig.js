const UPGRADES_CONFIG = {

  // === SILVER — TIERED ===
  x2_duration: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [100, 100, 100],
    effects: [5, 10, 15],
    description: "X2 Score duration"
  },

  score_plus_mult: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [100, 100, 100],
    effects: [1.5, 1.7, 2.0],
    description: "Score +300/500 multiplier"
  },

  score_minus_mult: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [100, 100, 100],
    effects: [0.9, 0.7, 0.5],
    description: "Score -300/500 reduction"
  },

  invert_score: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [100, 100, 100],
    effects: [1.5, 1.7, 2.0],
    description: "Invert score multiplier"
  },

  speed_up_mult: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [100, 100, 100],
    effects: [2, 3, 4],
    description: "Speed Up multiplier"
  },

  speed_down_mult: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [100, 100, 100],
    effects: [2, 3, 4],
    description: "Speed Down multiplier"
  },

  magnet_duration: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [100, 100, 100],
    effects: [5, 10, 15],
    description: "Magnet duration"
  },

  spin_cooldown: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [100, 100, 100],
    effects: [2, 3, 5],
    description: "Spin cooldown reduction"
  },

  // === GOLD — PERMANENT ===
  shield: {
    type: "permanent",
    currency: "gold",
    maxLevel: 1,
    prices: [10],
    effects: [true],
    description: "Start with shield (permanent)"
  },

  // === GOLD — RIDES PACK ===
  rides_pack: {
    type: "rides",
    currency: "gold",
    price: 10,
    amount: 3,
    description: "3 extra rides pack"
  }
};

function calculateEffects(upgrades) {
  return {
    x2_duration_bonus: upgrades.x2_duration > 0
      ? UPGRADES_CONFIG.x2_duration.effects[upgrades.x2_duration - 1]
      : 0,

    score_plus_multiplier: upgrades.score_plus_mult > 0
      ? UPGRADES_CONFIG.score_plus_mult.effects[upgrades.score_plus_mult - 1]
      : 1.0,

    score_minus_multiplier: upgrades.score_minus_mult > 0
      ? UPGRADES_CONFIG.score_minus_mult.effects[upgrades.score_minus_mult - 1]
      : 1.0,

    invert_score_multiplier: upgrades.invert_score > 0
      ? UPGRADES_CONFIG.invert_score.effects[upgrades.invert_score - 1]
      : 1.0,

    speed_up_multiplier: upgrades.speed_up_mult > 0
      ? UPGRADES_CONFIG.speed_up_mult.effects[upgrades.speed_up_mult - 1]
      : 1.0,

    speed_down_multiplier: upgrades.speed_down_mult > 0
      ? UPGRADES_CONFIG.speed_down_mult.effects[upgrades.speed_down_mult - 1]
      : 1.0,

    magnet_duration_bonus: upgrades.magnet_duration > 0
      ? UPGRADES_CONFIG.magnet_duration.effects[upgrades.magnet_duration - 1]
      : 0,

    spin_cooldown_reduction: upgrades.spin_cooldown > 0
      ? UPGRADES_CONFIG.spin_cooldown.effects[upgrades.spin_cooldown - 1]
      : 0,

    start_with_shield: upgrades.shield > 0
  };
}

module.exports = {
  UPGRADES_CONFIG,
  calculateEffects
};
