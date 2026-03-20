const test = require('node:test');
const assert = require('node:assert/strict');
const { Wallet } = require('ethers');
const mongoose = require('mongoose');

const Player = require('../models/Player');
const GameResult = require('../models/GameResult');
const PlayerUpgrades = require('../models/PlayerUpgrades');
const SecurityEvent = require('../models/SecurityEvent');
const LinkCode = require('../models/LinkCode');
const DonationPayment = require('../models/DonationPayment');
const { setDonationVerifierForTests, resetDonationVerifier } = require('../utils/donationService');

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
let donationPayments;

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
  donationPayments = [];
  DonationPayment.prototype.save = async function save() {
    const plain = this.toObject ? this.toObject() : { ...this };
    const index = donationPayments.findIndex((item) => item.paymentId === plain.paymentId);
    const stored = {
      ...plain,
      save: async function saveSelf() { return this; }
    };
    if (index >= 0) {
      donationPayments[index] = stored;
    } else {
      donationPayments.push(stored);
    }
    Object.assign(this, stored);
    return this;
  };
  DonationPayment.findOne = async (query = {}) => {
    const match = donationPayments.find((item) => {
      return Object.entries(query).every(([key, value]) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          if ('$in' in value) {
            return value.$in.includes(item[key]);
          }
          if ('$ne' in value) {
            return item[key] !== value.$ne;
          }
        }
        return item[key] === value;
      });
    });

    return match ? { ...match, save: async function saveSelf() {
      const index = donationPayments.findIndex((item) => item.paymentId === this.paymentId);
      const updated = { ...this, save: this.save };
      donationPayments[index] = updated;
      return this;
    } } : null;
  };
  resetDonationVerifier();
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

test('GET /api/store/donations/:wallet returns donation products with Starter Pack available', async () => {
  const wallet = Wallet.createRandom().address.toLowerCase();

  Player.findOne = () => queryResult({
    wallet,
    totalGoldCoins: 0,
    totalSilverCoins: 0
  });

  const { server, baseUrl } = await startServer();
  const res = await fetch(`${baseUrl}/api/store/donations/${wallet}`);

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.network, 'BSC');
  assert.equal(body.priceMode, 'test');
  assert.equal(body.products.length, 6);
  assert.equal(body.products[0].key, 'starter_pack');
  assert.equal(body.products[0].canPurchase, true);

  await server.close();
});

test('POST /api/store/donations/create-payment creates payment intent', async () => {
  const wallet = Wallet.createRandom().address.toLowerCase();

  Player.findOne = () => queryResult({
    wallet,
    totalGoldCoins: 0,
    totalSilverCoins: 0
  });

  const { server, baseUrl } = await startServer();
  const res = await fetch(`${baseUrl}/api/store/donations/create-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, productKey: 'starter_pack' })
  });

  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.status, 'created');
  assert.equal(body.productKey, 'starter_pack');
  assert.equal(body.amount, '0.02');
  assert.equal(body.currency, 'USDT');
  assert.equal(body.txRequest.to, '0x55d398326f99059ff775485246999027b3197955');
  assert.equal(body.txRequest.transferTo, '0x244bcc2721f1037958862825c3feb6a7be6204a7');
  assert.equal(body.txRequest.transferAmount, '0.02');
  assert.match(body.txRequest.data, /^0xa9059cbb/i);
  assert.equal(body.txRequest.walletPayload.method, 'eth_sendTransaction');
  assert.deepEqual(body.txRequest.walletPayload.params[0], {
    to: body.txRequest.to,
    value: '0x0',
    data: body.txRequest.data
  });

  await server.close();
});



test('POST /api/store/donations/create-payment accepts legacy productId alias', async () => {
  const wallet = Wallet.createRandom().address.toLowerCase();

  Player.findOne = () => queryResult({
    wallet,
    totalGoldCoins: 0,
    totalSilverCoins: 0
  });

  const { server, baseUrl } = await startServer();
  const res = await fetch(`${baseUrl}/api/store/donations/create-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, productId: 'starter_pack' })
  });

  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.productKey, 'starter_pack');

  await server.close();
});

test('POST /api/store/donations/submit-transaction credits player after successful verification', async () => {
  const wallet = Wallet.createRandom().address.toLowerCase();
  const player = {
    wallet,
    totalGoldCoins: 10,
    totalSilverCoins: 20,
    save: async function save() { return this; }
  };

  Player.findOne = ({ wallet: requestedWallet }) => queryResult(requestedWallet === wallet ? player : null);

  setDonationVerifierForTests(async () => ({
    status: 'confirmed',
    reason: 'confirmed',
    confirmations: 2,
    actualFrom: '0xsender',
    actualTo: '0x244bcc2721f1037958862825c3feb6a7be6204a7',
    actualAmount: '20000000000000000'
  }));

  const { server, baseUrl } = await startServer();

  const createRes = await fetch(`${baseUrl}/api/store/donations/create-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, productKey: 'starter_pack' })
  });
  const created = await createRes.json();

  const submitRes = await fetch(`${baseUrl}/api/store/donations/submit-transaction`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, paymentId: created.paymentId, txHash: '0xtesthash' })
  });

  assert.equal(submitRes.status, 200);
  const submitted = await submitRes.json();
  assert.equal(submitted.status, 'credited');
  assert.deepEqual(submitted.reward, { gold: 400, silver: 400 });
  assert.equal(submitted.txRequest.transferAmount, '0.02');
  assert.equal(player.totalGoldCoins, 410);
  assert.equal(player.totalSilverCoins, 420);

  await server.close();
});


test('GET /api/store/donations/payment/:paymentId accepts txHash recovery query and credits player', async () => {
  const wallet = Wallet.createRandom().address.toLowerCase();
  const player = {
    wallet,
    totalGoldCoins: 5,
    totalSilverCoins: 7,
    save: async function save() { return this; }
  };

  Player.findOne = ({ wallet: requestedWallet }) => queryResult(requestedWallet === wallet ? player : null);

  setDonationVerifierForTests(async () => ({
    status: 'confirmed',
    reason: 'confirmed',
    confirmations: 2,
    actualFrom: '0xsender',
    actualTo: '0x244bcc2721f1037958862825c3feb6a7be6204a7',
    actualAmount: '20000000000000000'
  }));

  const { server, baseUrl } = await startServer();

  const createRes = await fetch(`${baseUrl}/api/store/donations/create-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, productKey: 'starter_pack' })
  });
  const created = await createRes.json();

  const statusRes = await fetch(
    `${baseUrl}/api/store/donations/payment/${created.paymentId}?wallet=${encodeURIComponent(wallet)}&txHash=0xrecoverhash`
  );

  assert.equal(statusRes.status, 200);
  const recovered = await statusRes.json();
  assert.equal(recovered.status, 'credited');
  assert.equal(recovered.txHash, '0xrecoverhash');
  assert.equal(player.totalGoldCoins, 405);
  assert.equal(player.totalSilverCoins, 407);

  await server.close();
});

test('POST /api/store/donations/create-payment blocks second Starter Pack after successful credit', async () => {
  const wallet = Wallet.createRandom().address.toLowerCase();
  const player = {
    wallet,
    totalGoldCoins: 0,
    totalSilverCoins: 0,
    save: async function save() { return this; }
  };

  Player.findOne = () => queryResult(player);

  setDonationVerifierForTests(async () => ({
    status: 'confirmed',
    reason: 'confirmed',
    confirmations: 2,
    actualFrom: '0xsender',
    actualTo: '0x244bcc2721f1037958862825c3feb6a7be6204a7',
    actualAmount: '20000000000000000'
  }));

  const { server, baseUrl } = await startServer();

  const firstCreate = await fetch(`${baseUrl}/api/store/donations/create-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, productKey: 'starter_pack' })
  });
  const created = await firstCreate.json();

  await fetch(`${baseUrl}/api/store/donations/submit-transaction`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, paymentId: created.paymentId, txHash: '0xstarterhash' })
  });

  const secondCreate = await fetch(`${baseUrl}/api/store/donations/create-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, productKey: 'starter_pack' })
  });

  assert.equal(secondCreate.status, 409);
  const body = await secondCreate.json();
  assert.match(body.error, /already purchased/i);

  await server.close();
});


test('GET /api/game/config returns unauth preset built from backend config', async () => {
  const { server, baseUrl } = await startServer();

  const res = await fetch(`${baseUrl}/api/game/config?mode=unauth`);

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, 'unauth');
  assert.equal(body.saveProgress, false);
  assert.equal(body.eligibleForLeaderboard, false);
  assert.equal(body.storeEnabled, false);
  assert.equal(body.rides.limited, false);
  assert.equal(body.preset, 'all_improvements_enabled');
  assert.equal(body.activeEffects.start_with_shield, true);
  assert.equal(body.activeEffects.start_with_radar, true);
  assert.equal(body.activeEffects.perfect_spin_enabled, true);
  assert.equal(body.activeEffects.shield_capacity, 3);
  assert.equal(body.activeEffects.x2_duration_bonus, 15);

  await server.close();
});

test('GET /api/game/config rejects unknown mode', async () => {
  const { server, baseUrl } = await startServer();

  const res = await fetch(`${baseUrl}/api/game/config?mode=unknown`);

  assert.equal(res.status, 404);
  const body = await res.json();
  assert.match(body.error, /Unknown game mode config/i);

  await server.close();
});
