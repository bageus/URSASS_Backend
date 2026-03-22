const test = require('node:test');
const assert = require('node:assert/strict');

const AccountLink = require('../models/AccountLink');
const Player = require('../models/Player');
const PlayerUpgrades = require('../models/PlayerUpgrades');
const { mergeAccounts } = require('../utils/accountManager');

test('mergeAccounts stores schema-compatible masterSource value', async () => {
  const originalAccountLinkFindOne = AccountLink.findOne;
  const originalAccountLinkDeleteOne = AccountLink.deleteOne;
  const originalPlayerFindOne = Player.findOne;
  const originalPlayerUpgradesFindOne = PlayerUpgrades.findOne;

  const linkTelegram = {
    primaryId: 'tg_100',
    telegramId: '100',
    wallet: null,
    masterSource: null,
    save: async function save() { return this; }
  };
  const linkWallet = {
    primaryId: '0xabc',
    telegramId: null,
    wallet: '0xabc',
    masterSource: null,
    save: async function save() { return this; }
  };
  const playerTelegram = {
    wallet: 'tg_100',
    bestScore: 10,
    bestDistance: 5,
    totalGoldCoins: 1,
    totalSilverCoins: 2,
    gamesPlayed: 1,
    averageScore: 10,
    scoreToAverageRatio: 1,
    gameHistory: [{ score: 10, timestamp: new Date('2024-01-01T00:00:00Z') }],
    save: async function save() { return this; }
  };
  const playerWallet = {
    wallet: '0xabc',
    bestScore: 200,
    bestDistance: 50,
    totalGoldCoins: 10,
    totalSilverCoins: 20,
    gamesPlayed: 5,
    averageScore: 40,
    scoreToAverageRatio: 5,
    gameHistory: [{ score: 200, timestamp: new Date('2024-02-01T00:00:00Z') }],
    save: async function save() { return this; }
  };
  const upgradesTelegram = {
    x2_duration: 1,
    shield: 1,
    freeRidesRemaining: 2,
    paidRidesRemaining: 2,
    recentRideSessionIds: ['ride-a'],
    save: async function save() { return this; }
  };
  const upgradesWallet = {
    x2_duration: 3,
    shield: 0,
    freeRidesRemaining: 1,
    paidRidesRemaining: 7,
    recentRideSessionIds: ['ride-b'],
    save: async function save() { return this; }
  };

  try {
    AccountLink.findOne = async ({ primaryId }) => {
      if (primaryId === 'tg_100') return linkTelegram;
      if (primaryId === '0xabc') return linkWallet;
      return null;
    };
    AccountLink.deleteOne = async ({ primaryId }) => ({ deletedCount: primaryId === 'tg_100' ? 1 : 0 });

    Player.findOne = async ({ wallet }) => {
      if (wallet === 'tg_100') return playerTelegram;
      if (wallet === '0xabc') return playerWallet;
      return null;
    };

    PlayerUpgrades.findOne = async ({ wallet }) => {
      if (wallet === 'tg_100') return upgradesTelegram;
      if (wallet === '0xabc') return upgradesWallet;
      return null;
    };

    const result = await mergeAccounts('tg_100', '0xabc');

    assert.equal(result.success, true);
    assert.equal(result.primaryId, '0xabc');
    assert.equal(result.wallet, '0xabc');
    assert.equal(result.telegramId, '100');
    assert.equal(linkWallet.masterSource, 'wallet');
    assert.equal(linkWallet.telegramId, '100');
    assert.equal(playerWallet.totalGoldCoins, 11);
    assert.equal(playerWallet.totalSilverCoins, 22);
    assert.equal(playerWallet.gamesPlayed, 6);
    assert.equal(playerWallet.gameHistory.length, 2);
    assert.equal(playerWallet.averageScore, 35);
    assert.equal(playerWallet.bestScore, 200);
    assert.equal(upgradesWallet.x2_duration, 3);
    assert.equal(upgradesWallet.shield, 1);
    assert.equal(upgradesWallet.freeRidesRemaining, 2);
    assert.equal(upgradesWallet.paidRidesRemaining, 9);
    assert.deepEqual([...upgradesWallet.recentRideSessionIds].sort(), ['ride-a', 'ride-b']);
    assert.equal(playerTelegram.bestScore, 0);
    assert.equal(playerTelegram.gamesPlayed, 0);
    assert.equal(upgradesTelegram.paidRidesRemaining, 0);
    assert.deepEqual(upgradesTelegram.recentRideSessionIds, []);
  } finally {
    AccountLink.findOne = originalAccountLinkFindOne;
    AccountLink.deleteOne = originalAccountLinkDeleteOne;
    Player.findOne = originalPlayerFindOne;
    PlayerUpgrades.findOne = originalPlayerUpgradesFindOne;
  }
});
