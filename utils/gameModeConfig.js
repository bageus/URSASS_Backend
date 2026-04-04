const { calculateEffects } = require('./upgradesConfig');

const UNAUTH_MAX_UPGRADES = Object.freeze({
  x2_duration: 3,
  score_plus_300_mult: 3,
  score_plus_500_mult: 3,
  score_minus_300_mult: 3,
  score_minus_500_mult: 3,
  invert_score: 3,
  speed_up_mult: 3,
  speed_down_mult: 3,
  magnet_duration: 3,
  spin_cooldown: 3,
  shield: 1,
  shield_capacity: 2,
  radar_obstacles: 1,
  radar_gold: 1,
  radar: 1,
  alert: 2
});

function createUnauthUpgradesPreset(overrides = {}) {
  return {
    ...UNAUTH_MAX_UPGRADES,
    freeRidesRemaining: 3,
    paidRidesRemaining: 0,
    getTotalRides() {
      return this.freeRidesRemaining + this.paidRidesRemaining;
    },
    ...overrides
  };
}

function getGameModeConfig(mode = 'unauth') {
  const normalizedMode = String(mode || 'unauth').trim().toLowerCase();

  if (normalizedMode !== 'unauth') {
    return null;
  }

  const upgrades = createUnauthUpgradesPreset();

  return {
    mode: 'unauth',
    preset: 'all_improvements_enabled',
    authRequired: false,
    saveProgress: false,
    eligibleForLeaderboard: false,
    storeEnabled: false,
    rides: {
      limited: false,
      freeRides: null,
      paidRides: null,
      totalRides: null,
      resetInMs: null,
      resetInFormatted: null
    },
    balance: {
      gold: 0,
      silver: 0
    },
    activeEffects: calculateEffects(upgrades)
  };
}

module.exports = {
  UNAUTH_MAX_UPGRADES,
  createUnauthUpgradesPreset,
  getGameModeConfig
};
