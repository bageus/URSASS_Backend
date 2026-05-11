const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../models/Player');
const { getGameplayHistorySnapshot } = require('../services/onboardingService');

test('getGameplayHistorySnapshot returns zeroed snapshot for player with no history', async () => {
  const originalPlayerFindOne = Player.findOne;
  Player.findOne = () => ({ select: () => ({ lean: async () => null }) });
  try {
    const snapshot = await getGameplayHistorySnapshot('0xnew');
    assert.equal(snapshot.raceCount, 0);
    assert.equal(snapshot.xConnected, false);
  } finally {
    Player.findOne = originalPlayerFindOne;
  }
});
