const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateEffects } = require('../utils/upgradesConfig');

test('temporary radar boosts activate effects without permanent upgrades', () => {
  const now = Date.now();
  const upgrades = {
    radar_obstacles: 0,
    radar_gold: 0,
    temporaryBoosts: {
      radarObstaclesUntil: new Date(now + 60_000),
      radarGoldUntil: new Date(now + 60_000)
    }
  };

  const effects = calculateEffects(upgrades);
  assert.equal(effects.start_with_radar_obstacles, true);
  assert.equal(effects.start_with_radar_gold, true);
  assert.equal(effects.start_with_radar, true);
});

test('expired temporary radar boosts do not activate effects', () => {
  const now = Date.now();
  const upgrades = {
    radar_obstacles: 0,
    radar_gold: 0,
    temporaryBoosts: {
      radarObstaclesUntil: new Date(now - 60_000),
      radarGoldUntil: new Date(now - 60_000)
    }
  };

  const effects = calculateEffects(upgrades);
  assert.equal(effects.start_with_radar_obstacles, false);
  assert.equal(effects.start_with_radar_gold, false);
  assert.equal(effects.start_with_radar, false);
});
