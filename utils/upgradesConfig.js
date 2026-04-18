const isTestEnv = process.env.NODE_ENV === 'test';
const TEST_GOLD_PRICE = 1;

function goldPrice(defaultPrice) {
  return isTestEnv ? TEST_GOLD_PRICE : defaultPrice;
}

function toUpgradeLevel(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === 'false' || normalized === 'null' || normalized === 'undefined') {
      return 0;
    }
    if (normalized === 'true') {
      return 1;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

const UPGRADES_CONFIG = {

  // === SILVER — TIERED ===
  x2_duration: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [300, 2400, 8000],
    effects: [5, 10, 15],
    description: "X2 Score duration"
  },

  score_plus_300_mult: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [300, 2400, 8000],
    effects: [1.5, 1.7, 2.0],
    description: "Score +300 bonus multiplier"
  },

  score_plus_500_mult: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [300, 2400, 8000],
    effects: [1.5, 1.7, 2.0],
    description: "Score +500 bonus multiplier"
  },

  score_minus_300_mult: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [300, 2400, 8000],
    effects: [0.9, 0.7, 0.5],
    description: "Score -300 penalty reduction"
  },

  score_minus_500_mult: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [300, 2400, 8000],
    effects: [0.9, 0.7, 0.5],
    description: "Score -500 penalty reduction"
  },

  invert_score: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [300, 2400, 8000],
    effects: [1.5, 1.7, 2.0],
    description: "Invert score multiplier"
  },

  speed_up_mult: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [300, 2400, 8000],
    effects: [2, 3, 4],
    description: "Speed Up multiplier"
  },

  speed_down_mult: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [300, 2400, 8000],
    effects: [2, 3, 4],
    description: "Speed Down multiplier"
  },

  magnet_duration: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [300, 2400, 8000],
    effects: [5, 10, 15],
    description: "Magnet duration"
  },

  spin_cooldown: {
    type: "tiered",
    currency: "silver",
    maxLevel: 3,
    prices: [300, 2400, 8000],
    effects: [2, 3, 5],
    description: "Spin cooldown reduction"
  },

  // === GOLD — PERMANENT ===
  shield: {
    type: "permanent",
    currency: "gold",
    maxLevel: 1,
    prices: [goldPrice(400)],
    effects: [true],
    description: "Start with shield"
  },

  shield_capacity: {
    type: "permanent",
    currency: "gold",
    maxLevel: 2,
    prices: [goldPrice(2000), goldPrice(5000)],
    effects: [2, 3],
    description: "Shield capacity progression: 2 -> 3"
  },

  radar_obstacles: {
    type: "permanent",
    currency: "gold",
    maxLevel: 1,
    prices: [goldPrice(2000)],
    effects: [true],
    description: "Obstacle Radar (delayed spawn tracking)"
  },

  radar_gold: {
    type: "permanent",
    currency: "gold",
    maxLevel: 1,
    prices: [goldPrice(3000)],
    effects: [true],
    description: "Gold Radar (next coin spawn line)"
  },

  alert: {
    type: "permanent",
    currency: "gold",
    maxLevel: 2,
    prices: [goldPrice(1000), goldPrice(3000)],
    effects: ["alert", "perfect"],
    description: "Spin alert progression: alert -> perfect"
  },

  // === GOLD — RIDES PACK ===
  rides_pack: {
    type: "rides",
    currency: "gold",
    price: 70,
    amount: 3,
    description: "3 extra rides pack"
  }
};

function calculateEffects(upgrades) {
  const x2DurationLevel = toUpgradeLevel(upgrades.x2_duration);
  const scorePlus300Level = toUpgradeLevel(upgrades.score_plus_300_mult);
  const scorePlus500Level = toUpgradeLevel(upgrades.score_plus_500_mult);
  const scoreMinus300Level = toUpgradeLevel(upgrades.score_minus_300_mult);
  const scoreMinus500Level = toUpgradeLevel(upgrades.score_minus_500_mult);
  const invertScoreLevel = toUpgradeLevel(upgrades.invert_score);
  const speedUpLevel = toUpgradeLevel(upgrades.speed_up_mult);
  const speedDownLevel = toUpgradeLevel(upgrades.speed_down_mult);
  const magnetDurationLevel = toUpgradeLevel(upgrades.magnet_duration);
  const spinCooldownLevel = toUpgradeLevel(upgrades.spin_cooldown);
  const legacyShieldLevel = toUpgradeLevel(upgrades.shield);
  const shieldCapacityLevel = toUpgradeLevel(upgrades.shield_capacity);
  const radarObstaclesLevel = toUpgradeLevel(upgrades.radar_obstacles);
  const radarGoldLevel = toUpgradeLevel(upgrades.radar_gold);
  const legacyRadarLevel = toUpgradeLevel(upgrades.radar);
  const alertLevel = toUpgradeLevel(upgrades.alert);

  const hasSeparateShieldCapacity = Number.isFinite(shieldCapacityLevel);
  const normalizedShieldLevel = legacyShieldLevel > 0 ? 1 : 0;
  const normalizedShieldCapacityLevel = hasSeparateShieldCapacity
    ? shieldCapacityLevel
    : Math.max(0, legacyShieldLevel - 1);
  const normalizedRadarGoldLevel = radarGoldLevel > 0 ? radarGoldLevel : legacyRadarLevel;

  return {
    x2_duration_bonus: x2DurationLevel > 0
      ? UPGRADES_CONFIG.x2_duration.effects[x2DurationLevel - 1]
      : 0,

    score_plus_300_multiplier: scorePlus300Level > 0
      ? UPGRADES_CONFIG.score_plus_300_mult.effects[scorePlus300Level - 1]
      : 1.0,

    score_plus_500_multiplier: scorePlus500Level > 0
      ? UPGRADES_CONFIG.score_plus_500_mult.effects[scorePlus500Level - 1]
      : 1.0,

    score_minus_300_multiplier: scoreMinus300Level > 0
      ? UPGRADES_CONFIG.score_minus_300_mult.effects[scoreMinus300Level - 1]
      : 1.0,

    score_minus_500_multiplier: scoreMinus500Level > 0
      ? UPGRADES_CONFIG.score_minus_500_mult.effects[scoreMinus500Level - 1]
      : 1.0,

    invert_score_multiplier: invertScoreLevel > 0
      ? UPGRADES_CONFIG.invert_score.effects[invertScoreLevel - 1]
      : 1.0,

    speed_up_multiplier: speedUpLevel > 0
      ? UPGRADES_CONFIG.speed_up_mult.effects[speedUpLevel - 1]
      : 1.0,

    speed_down_multiplier: speedDownLevel > 0
      ? UPGRADES_CONFIG.speed_down_mult.effects[speedDownLevel - 1]
      : 1.0,

    magnet_duration_bonus: magnetDurationLevel > 0
      ? UPGRADES_CONFIG.magnet_duration.effects[magnetDurationLevel - 1]
      : 0,

    spin_cooldown_reduction: spinCooldownLevel > 0
      ? UPGRADES_CONFIG.spin_cooldown.effects[spinCooldownLevel - 1]
      : 0,

    shield_level: normalizedShieldLevel,
    shield_capacity_level: normalizedShieldCapacityLevel,
    shield_capacity: normalizedShieldCapacityLevel > 0
      ? UPGRADES_CONFIG.shield_capacity.effects[normalizedShieldCapacityLevel - 1]
      : 1,
    start_with_shield: normalizedShieldLevel > 0,
    start_with_radar_obstacles: radarObstaclesLevel > 0,
    start_with_radar_gold: normalizedRadarGoldLevel > 0,
    // Backward compatibility for clients that still read `start_with_radar`.
    start_with_radar: normalizedRadarGoldLevel > 0,
    alert_level: alertLevel,
    spin_alert_mode: alertLevel > 0
      ? UPGRADES_CONFIG.alert.effects[alertLevel - 1]
      : null,
    start_with_alert: alertLevel > 0,
    perfect_spin_enabled: alertLevel >= 2
  };
}

module.exports = {
  UPGRADES_CONFIG,
  calculateEffects
};
