const test = require('node:test');
const assert = require('node:assert/strict');

const CoinTransaction = require('../models/CoinTransaction');
const { recordCoinReward } = require('../utils/coinHistory');

test('recordCoinReward: stores normalized positive reward', async () => {
  let createdDoc = null;
  CoinTransaction.create = async (doc) => {
    createdDoc = doc;
    return doc;
  };

  const result = await recordCoinReward('TG_Player_1', 'share', { gold: 20, silver: 0 });
  assert.ok(result);
  assert.equal(createdDoc.primaryId, 'tg_player_1');
  assert.equal(createdDoc.type, 'share');
  assert.equal(createdDoc.gold, 20);
  assert.equal(createdDoc.silver, 0);
});

test('recordCoinReward: skips zero rewards', async () => {
  let called = false;
  CoinTransaction.create = async () => {
    called = true;
    return null;
  };

  const result = await recordCoinReward('tg_player_2', 'ride', { gold: 0, silver: 0 });
  assert.equal(result, null);
  assert.equal(called, false);
});
