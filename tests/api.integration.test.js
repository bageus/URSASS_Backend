const test = require('node:test');
const assert = require('node:assert/strict');
const { Wallet } = require('ethers');
const mongoose = require('mongoose');

const Player = require('../models/Player');
const GameResult = require('../models/GameResult');
const PlayerUpgrades = require('../models/PlayerUpgrades');
const SecurityEvent = require('../models/SecurityEvent');
const LinkCode = require('../models/LinkCode');

const { createApp } = require('../app');

function queryResult(result) {
  return {
    session() { return this; },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    }
  };
}

async function startServer() {
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

let originalStartSession;

test.before(() => {
  process.env.TELEGRAM_BOT_SECRET = 'test-secret';
  originalStartSession = mongoose.startSession;
  mongoose.startSession = async () => {
    const err = new Error('Transactions unsupported in tests');
    err.code = 20;
    throw err;
  };
});

test.after(() => {
  mongoose.startSession = originalStartSession;
});

test.beforeEach(() => {
  SecurityEvent.create = async () => ({ _id: 'sec' });
  SecurityEvent.countDocuments = async () => 0;
  GameResult.create = async () => ([{ _id: 'gr' }]);
  Player.prototype.save = async function save() { return this; };
  PlayerUpgrades.prototype.save = async function save() { return this; };
  LinkCode.deleteOne = async () => ({ deletedCount: 1 });
});

test('POST /api/leaderboard/save rejects invalid signature', async () => {
  GameResult.findOne = () => queryResult(null);
  Player.findOne = () => queryResult(null);

  const { server, baseUrl } = await startServer();
  const now = Date.now();

  const res = await fetch(`${baseUrl}/api/leaderboard/save`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      wallet: '0x1111111111111111111111111111111111111111',
      score: 100,
      distance: 50,
      signature: '0xdeadbeef',
      timestamp: now
    })
  });

  assert.equal(res.status, 401);
  await server.close();
});

test('POST /api/leaderboard/save accepts valid signature and blocks replay', async () => {
  const wallet = Wallet.createRandom();
  const seenSignatures = new Set();

  GameResult.findOne = ({ signature }) => queryResult(seenSignatures.has(signature) ? { signature } : null);
  GameResult.create = async (docs) => {
    seenSignatures.add(docs[0].signature);
    return docs;
  };
  Player.findOne = () => queryResult(null);

  const { server, baseUrl } = await startServer();
  const timestamp = Date.now();
  const message = `Save game result\nWallet: ${wallet.address}\nScore: 200\nDistance: 80\nTimestamp: ${timestamp}`;
  const signature = await wallet.signMessage(message);

  const payload = {
    wallet: wallet.address,
    score: 200,
    distance: 80,
    signature,
    timestamp
  };

  const first = await fetch(`${baseUrl}/api/leaderboard/save`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
  });
  assert.equal(first.status, 200);

  const second = await fetch(`${baseUrl}/api/leaderboard/save`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
  });
  assert.equal(second.status, 409);

  await server.close();
});

test('POST /api/store/buy returns insufficient funds', async () => {
  const wallet = Wallet.createRandom();
  const walletLower = wallet.address.toLowerCase();
  const timestamp = Date.now();
  const upgradeKey = 'x2_duration';
  const tier = 0;
  const message = `Buy upgrade\nWallet: ${walletLower}\nUpgrade: ${upgradeKey}\nTier: ${tier}\nTimestamp: ${timestamp}`;
  const signature = await wallet.signMessage(message);

  Player.findOne = () => ({
    totalSilverCoins: 10,
    totalGoldCoins: 10,
    save: async function save() { return this; }
  });
  PlayerUpgrades.findOne = async () => ({
    refreshFreeRides() {},
    getTotalRides() { return 0; },
    save: async function save() { return this; }
  });

  const { server, baseUrl } = await startServer();
  const res = await fetch(`${baseUrl}/api/store/buy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: wallet.address, upgradeKey, tier, signature, timestamp })
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Not enough silver/i);
  await server.close();
});

test('POST /api/store/buy returns tier mismatch', async () => {
  const wallet = Wallet.createRandom();
  const walletLower = wallet.address.toLowerCase();
  const timestamp = Date.now();
  const upgradeKey = 'x2_duration';
  const tier = 1;
  const message = `Buy upgrade\nWallet: ${walletLower}\nUpgrade: ${upgradeKey}\nTier: ${tier}\nTimestamp: ${timestamp}`;
  const signature = await wallet.signMessage(message);

  Player.findOne = async () => ({
    totalSilverCoins: 5000,
    totalGoldCoins: 5000,
    save: async function save() { return this; }
  });
  PlayerUpgrades.findOne = async () => ({
    x2_duration: 0,
    refreshFreeRides() {},
    getTotalRides() { return 0; },
    save: async function save() { return this; }
  });

  const { server, baseUrl } = await startServer();
  const res = await fetch(`${baseUrl}/api/store/buy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: wallet.address, upgradeKey, tier, signature, timestamp })
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Must buy tier 0/i);
  await server.close();
});

test('POST /api/account/link/verify-telegram enforces rate limit', async () => {
  LinkCode.findOne = async () => null;

  const { server, baseUrl } = await startServer();
  let status = 0;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(`${baseUrl}/api/account/link/verify-telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ telegramId: '555', code: 'AAAAAA', botSecret: 'test-secret' })
    });
    status = res.status;
  }

  assert.equal(status, 429);
  await server.close();
});

test('POST /api/account/link/verify-telegram rejects expired code', async () => {
  LinkCode.findOne = async () => ({
    _id: 'code-id',
    expiresAt: new Date(Date.now() - 60_000),
    used: false,
    save: async function save() { return this; }
  });

  const { server, baseUrl } = await startServer();
  const res = await fetch(`${baseUrl}/api/account/link/verify-telegram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ telegramId: '777', code: 'EXPIRE', botSecret: 'test-secret' })
  });

  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Code expired/i);
  await server.close();
});
