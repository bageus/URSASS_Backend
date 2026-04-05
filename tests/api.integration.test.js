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
const AccountLink = require('../models/AccountLink');
const { setDonationVerifierForTests, resetDonationVerifier } = require('../utils/donationService');
const { setTelegramStarsClientForTests } = require('../utils/telegramStarsService');
const crypto = require('crypto');

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
  process.env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret';
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
  AccountLink.prototype.save = async function save() { return this; };
  const accountLinks = [];
  const matchesSimple = (item, query = {}) => Object.entries(query).every(([key, value]) => item[key] === value);
  AccountLink.findOne = async (query = {}) => accountLinks.find((item) => matchesSimple(item, query)) || null;
  const originalAccountLinkSave = AccountLink.prototype.save;
  AccountLink.prototype.save = async function saveAccountLink() {
    const plain = this.toObject ? this.toObject() : { ...this };
    const idx = accountLinks.findIndex((item) => item.primaryId === plain.primaryId || (plain.telegramId && item.telegramId === plain.telegramId) || (plain.wallet && item.wallet === plain.wallet));
    if (idx >= 0) accountLinks[idx] = plain; else accountLinks.push(plain);
    Object.assign(this, plain);
    return this;
  };
  setTelegramStarsClientForTests({
    async createInvoiceLink(payload) {
      const rawPayload = String(payload.payload || '');
      const orderId = rawPayload.startsWith('v1:') ? rawPayload.slice(3) : JSON.parse(rawPayload).orderId;
      return `https://t.me/invoice/${orderId}`;
    },
    async answerPreCheckoutQuery() { return true; }
  });
  donationPayments = [];
  DonationPayment.prototype.save = async function save() {
    const now = new Date();
    if (!this.createdAt) {
      this.createdAt = now;
    }
    this.updatedAt = now;

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
  const matchesDonationQuery = (item, query = {}) => Object.entries(query).every(([key, value]) => {
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

  DonationPayment.findOne = async (query = {}) => {
    const match = donationPayments.find((item) => matchesDonationQuery(item, query));

    return match ? { ...match, save: async function saveSelf() {
      const index = donationPayments.findIndex((item) => item.paymentId === this.paymentId);
      const updated = { ...this, updatedAt: new Date(), save: this.save };
      donationPayments[index] = updated;
      return this;
    } } : null;
  };
  

  DonationPayment.findOneAndUpdate = async (query = {}, update = {}, options = {}) => {
    const index = donationPayments.findIndex((item) => matchesDonationQuery(item, query));
    if (index < 0) {
      return null;
    }

    const current = donationPayments[index];
    const next = {
      ...current,
      ...(update.$set || {}),
      updatedAt: new Date()
    };
    donationPayments[index] = next;
    return options.new ? { ...next, save: async function saveSelf() { return this; } } : { ...current, save: async function saveSelf() { return this; } };
  };

  DonationPayment.find = (query = {}) => {
    let results = donationPayments.filter((item) => matchesDonationQuery(item, query)).map((item) => ({ ...item }));

    const chain = {
      sort(sortSpec = {}) {
        const [[field, direction]] = Object.entries(sortSpec);
        results = results.sort((a, b) => {
          const av = new Date(a[field] || 0).getTime();
          const bv = new Date(b[field] || 0).getTime();
          return direction < 0 ? bv - av : av - bv;
        });
        return chain;
      },
      limit(limitValue) {
        results = results.slice(0, limitValue);
        return Promise.resolve(results.map((item) => ({ ...item })));
      },
      then(resolve, reject) {
        return Promise.resolve(results.map((item) => ({ ...item }))).then(resolve, reject);
      }
    };

    return chain;
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

test('GET /health reports actual mongoose connection state', async () => {
  const originalReadyState = mongoose.connection.readyState;

  try {
    mongoose.connection.readyState = 2;

    const { server, baseUrl } = await startServer();
    const res = await fetch(`${baseUrl}/health`);

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'DEGRADED');
    assert.equal(body.mongodb, 'connecting');
    assert.equal(body.mongodbDetails.readyState, 2);
    assert.equal(body.mongodbDetails.status, 'connecting');

    await server.close();
  } finally {
    mongoose.connection.readyState = originalReadyState;
  }
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

test('POST /api/account/link/verify-telegram returns 503 when TELEGRAM_BOT_SECRET is not configured', async () => {
  const originalSecret = process.env.TELEGRAM_BOT_SECRET;
  let server;

  try {
    delete process.env.TELEGRAM_BOT_SECRET;

    const started = await startServer();
    server = started.server;
    const { baseUrl } = started;

    const res = await fetch(`${baseUrl}/api/account/link/verify-telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ telegramId: '777', code: 'SECRETLESS' })
    });

    assert.equal(res.status, 503);
    const body = await res.json();
    assert.match(body.error, /not configured/i);
  } finally {
    if (originalSecret) {
      process.env.TELEGRAM_BOT_SECRET = originalSecret;
    }
    if (server) {
      await server.close();
    }
  }
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
  assert.equal(body.network, 'Base');
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
  assert.equal(body.status, null);
  assert.equal(body.productKey, 'starter_pack');
  assert.equal(body.amount, '2');
  assert.equal(body.currency, 'USDT');
  assert.equal(body.txRequest.to, '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2');
  assert.equal(body.txRequest.transferTo, '0xbae8504df4e9816934e13390b4e83d408b7db5d8');
  assert.equal(body.txRequest.transferAmount, '2');
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
    actualTo: '0xbae8504df4e9816934e13390b4e83d408b7db5d8',
    actualAmount: '2000000000000000000'
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
  assert.equal(submitted.txRequest.transferAmount, '2');
  assert.equal(player.totalGoldCoins, 410);
  assert.equal(player.totalSilverCoins, 420);

  await server.close();
});


test('GET /api/store/donations/history/:wallet returns payments sorted by newest first', async () => {
  const wallet = Wallet.createRandom().address.toLowerCase();
  const player = {
    wallet,
    totalGoldCoins: 0,
    totalSilverCoins: 0,
    save: async function save() { return this; }
  };

  Player.findOne = () => queryResult(player);

  setDonationVerifierForTests(async () => ({
    status: 'pending',
    reason: 'awaiting_confirmations',
    confirmations: 0,
    actualFrom: '0xsender',
    actualTo: '0xbae8504df4e9816934e13390b4e83d408b7db5d8',
    actualAmount: '3000000000000000000'
  }));

  const { server, baseUrl } = await startServer();

  const firstCreate = await fetch(`${baseUrl}/api/store/donations/create-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, productKey: 'starter_pack' })
  });
  const firstPayment = await firstCreate.json();

  await new Promise((resolve) => setTimeout(resolve, 5));

  const secondCreate = await fetch(`${baseUrl}/api/store/donations/create-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, productKey: 'basic_pack' })
  });
  const secondPayment = await secondCreate.json();

  await fetch(`${baseUrl}/api/store/donations/submit-transaction`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, paymentId: secondPayment.paymentId, txHash: '0xpendinghash' })
  });

  const historyRes = await fetch(`${baseUrl}/api/store/donations/history/${wallet}`);

  assert.equal(historyRes.status, 200);
  const history = await historyRes.json();
  assert.equal(history.wallet, wallet);
  assert.equal(history.payments.length, 2);
  assert.equal(history.payments[0].paymentId, secondPayment.paymentId);
  assert.equal(history.payments[0].status, 'submitted');
  assert.equal(history.payments[0].paymentMethod, 'wallet');
  assert.equal(history.payments[0].paymentProvider, 'wallet');
  assert.equal(history.payments[0].paymentCategory, 'crypto');
  assert.equal(history.payments[0].title, 'Basic Pack');
  assert.equal(history.payments[0].amount, '9');
  assert.equal(history.payments[0].paymentAmount, '9');
  assert.equal(history.payments[0].amountValue, '9');
  assert.equal(history.payments[0].currency, 'USDT');
  assert.equal(history.payments[0].paymentMethodLegacy, 'crypto');
  assert.deepEqual(history.payments[0].payment, {
    method: 'wallet',
    provider: 'wallet',
    category: 'crypto',
    amount: '9',
    amountValue: '9',
    currency: 'USDT',
    amountByMethod: '9',
    unit: 'USDT'
  });
  assert.equal(history.payments[0].txRequest, null);
  assert.ok(history.payments[0].createdAt);
  assert.equal(history.payments[1].paymentId, firstPayment.paymentId);
  assert.equal(history.payments[1].status, null);

  await server.close();
});
;


test('GET /api/store/donations/payment/:paymentId returns failed after 30 minute verification timeout', async () => {
  const wallet = Wallet.createRandom().address.toLowerCase();
  const player = {
    wallet,
    totalGoldCoins: 0,
    totalSilverCoins: 0,
    save: async function save() { return this; }
  };

  Player.findOne = () => queryResult(player);

  setDonationVerifierForTests(async () => ({
    status: 'pending',
    reason: 'receipt_not_found',
    confirmations: 0
  }));

  const { server, baseUrl } = await startServer();

  const createRes = await fetch(`${baseUrl}/api/store/donations/create-payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, productKey: 'basic_pack' })
  });
  const created = await createRes.json();

  await fetch(`${baseUrl}/api/store/donations/submit-transaction`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, paymentId: created.paymentId, txHash: '0xtimeouthash' })
  });

  const paymentIndex = donationPayments.findIndex((item) => item.paymentId === created.paymentId);
  donationPayments[paymentIndex] = {
    ...donationPayments[paymentIndex],
    submittedAt: new Date(Date.now() - (30 * 60 * 1000) - 1000),
    expiresAt: new Date(Date.now() - 1000)
  };

  const paymentRes = await fetch(`${baseUrl}/api/store/donations/payment/${created.paymentId}?wallet=${wallet}`);
  assert.equal(paymentRes.status, 200);
  const payment = await paymentRes.json();
  assert.equal(payment.status, 'failed');
  assert.equal(payment.failureReason, 'merchant_confirmation_timeout');

  await server.close();
});

test('GET /api/store/donations/payment/:paymentId does not double-credit on refresh', async () => {
  const wallet = Wallet.createRandom().address.toLowerCase();
  let saveCalls = 0;
  const player = {
    wallet,
    totalGoldCoins: 10,
    totalSilverCoins: 20,
    save: async function save() {
      saveCalls += 1;
      return this;
    }
  };

  Player.findOne = ({ wallet: requestedWallet }) => queryResult(requestedWallet === wallet ? player : null);

  setDonationVerifierForTests(async () => ({
    status: 'confirmed',
    reason: 'confirmed',
    confirmations: 2,
    actualFrom: '0xsender',
    actualTo: '0xbae8504df4e9816934e13390b4e83d408b7db5d8',
    actualAmount: '2000000000000000000'
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
    body: JSON.stringify({ wallet, paymentId: created.paymentId, txHash: '0xrefreshhash' })
  });
  assert.equal(submitRes.status, 200);

  const refreshRes = await fetch(`${baseUrl}/api/store/donations/payment/${created.paymentId}?wallet=${wallet}`);
  assert.equal(refreshRes.status, 200);
  const refreshed = await refreshRes.json();
  assert.equal(refreshed.status, 'credited');
  assert.equal(player.totalGoldCoins, 410);
  assert.equal(player.totalSilverCoins, 420);
  assert.equal(saveCalls, 1);

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
    actualTo: '0xbae8504df4e9816934e13390b4e83d408b7db5d8',
    actualAmount: '2000000000000000000'
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
  assert.equal(body.activeEffects.start_with_radar_gold, true);
  assert.equal(body.activeEffects.start_with_radar_obstacles, true);
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


function buildTelegramInitData(user, botToken) {
  const authDate = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('query_id', 'test-query');
  params.set('user', JSON.stringify(user));
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
}


test('CORS rejects non-whitelisted *.vercel.app origins', async () => {
  const { server, baseUrl } = await startServer();

  const res = await fetch(`${baseUrl}/health`, {
    headers: {
      Origin: 'https://evil-app.vercel.app'
    }
  });

  assert.equal(res.status, 403);
  assert.equal(res.headers.get('access-control-allow-origin'), null);

  await server.close();
});

test('OPTIONS /api/donations/stars/create allows Telegram Mini App header in CORS preflight', async () => {
  const { server, baseUrl } = await startServer();

  const res = await fetch(`${baseUrl}/api/donations/stars/create`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://ursass-tube.vercel.app',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-telegram-init-data'
    }
  });

  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://ursass-tube.vercel.app');
  assert.match(res.headers.get('access-control-allow-headers') || '', /x-telegram-init-data/i);
  assert.match(res.headers.get('access-control-allow-methods') || '', /POST/i);

  await server.close();
});

test('POST /api/donations/stars/create creates Telegram Stars order and returns invoiceUrl', async () => {
  process.env.TELEGRAM_BOT_TOKEN = '123456:stars-token';
  const { server, baseUrl } = await startServer();
  const initData = buildTelegramInitData({ id: 777001, first_name: 'Stars' }, process.env.TELEGRAM_BOT_TOKEN);

  Player.findOne = ({ wallet }) => queryResult(wallet === 'tg_777001' ? null : null);
  Player.prototype.save = async function save() { return this; };
  PlayerUpgrades.findOne = () => queryResult(null);

  const res = await fetch(`${baseUrl}/api/donations/stars/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productKey: 'basic_pack', telegramInitData: initData })
  });

  assert.equal(res.status, 201);
  const body = await res.json();
  assert.ok(body.orderId);
  assert.match(body.invoiceUrl, /https:\/\/t\.me\/invoice\//);

  const created = donationPayments.find((item) => item.paymentId === body.orderId);
  assert.equal(created.paymentMethod, 'telegram_stars');
  assert.equal(created.status, 'created');
  assert.equal(created.telegramUserId, '777001');
  assert.equal(created.starsAmount, 450);
  assert.equal(created.currency, 'XTR');
  assert.equal(created.invoicePayload, `v1:${body.orderId}`);
  assert.ok(Buffer.byteLength(created.invoicePayload, 'utf8') <= 128);

  await server.close();
});

test('POST /api/donations/stars/create returns controlled 503 for Telegram bot token misconfiguration', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'bad-token';
  const { server, baseUrl } = await startServer();
  const initData = buildTelegramInitData({ id: 777002, first_name: 'Broken' }, 'bad-token');

  const res = await fetch(`${baseUrl}/api/donations/stars/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productKey: 'basic_pack', telegramInitData: initData })
  });

  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.code, 'telegram_stars_invalid_bot_token');
  assert.match(body.error, /TELEGRAM_BOT_TOKEN format is invalid/i);

  await server.close();
});

test('POST /api/donations/stars/create returns Telegram setup errors instead of opaque 502 body', async () => {
  process.env.TELEGRAM_BOT_TOKEN = '123456:stars-token';
  setTelegramStarsClientForTests({
    async createInvoiceLink() {
      const error = new Error('Telegram Stars invoice creation failed: Bad Request: STARS_INVOICE_INVALID');
      error.statusCode = 502;
      error.code = 'telegram_stars_upstream_rejected';
      error.details = { operation: 'createInvoiceLink', responseStatus: 400, description: 'Bad Request: STARS_INVOICE_INVALID' };
      throw error;
    },
    async answerPreCheckoutQuery() { return true; }
  });

  const { server, baseUrl } = await startServer();
  const initData = buildTelegramInitData({ id: 777003, first_name: 'Upstream' }, process.env.TELEGRAM_BOT_TOKEN);

  const res = await fetch(`${baseUrl}/api/donations/stars/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productKey: 'basic_pack', telegramInitData: initData })
  });

  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.code, 'telegram_stars_upstream_rejected');
  assert.equal(body.details.description, 'Bad Request: STARS_INVOICE_INVALID');

  await server.close();
});
test('POST /api/donations/stars/confirm credits Telegram Stars order from Mini App callback when webhook is missing', async () => {
  process.env.TELEGRAM_BOT_TOKEN = '123456:stars-token';
  const { server, baseUrl } = await startServer();
  const initData = buildTelegramInitData({ id: 777005, first_name: 'Recover' }, process.env.TELEGRAM_BOT_TOKEN);

  let player = { wallet: 'tg_777005', totalGoldCoins: 0, totalSilverCoins: 0, save: async function save() { return this; } };
  Player.findOne = ({ wallet }) => queryResult(wallet === 'tg_777005' ? player : null);
  Player.prototype.save = async function save() { player = this; return this; };
  PlayerUpgrades.findOne = () => queryResult(null);

  const createRes = await fetch(`${baseUrl}/api/donations/stars/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.51' },
    body: JSON.stringify({ productKey: 'starter_pack', telegramInitData: initData })
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();

  const confirmRes = await fetch(`${baseUrl}/api/donations/stars/confirm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.52' },
    body: JSON.stringify({
      orderId: created.orderId,
      totalAmount: 100,
      currency: 'XTR',
      telegramInitData: initData
    })
  });

  assert.equal(confirmRes.status, 200);
  const confirmed = await confirmRes.json();
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.order.status, 'paid');
  assert.ok(confirmed.order.rewardGrantedAt);

  const updated = donationPayments.find((item) => item.paymentId === created.orderId);
  assert.equal(updated.status, 'paid');
  assert.equal(updated.providerStatus, 'telegram_invoice_callback');
  assert.ok(updated.rewardGrantedAt);
  assert.equal(player.totalGoldCoins, 400);
  assert.equal(player.totalSilverCoins, 400);

  const historyRes = await fetch(`${baseUrl}/api/store/donations/history/tg_777005`);
  assert.equal(historyRes.status, 200);
  const history = await historyRes.json();
  assert.equal(history.payments[0].status, 'paid');

  await server.close();
});

test('POST /api/telegram/webhook accepts pre_checkout_query for compact Stars payload', async () => {
  process.env.TELEGRAM_BOT_TOKEN = '123456:stars-token';
  const { server, baseUrl } = await startServer();
  const initData = buildTelegramInitData({ id: 777004, first_name: 'Checkout' }, process.env.TELEGRAM_BOT_TOKEN);

  Player.findOne = ({ wallet }) => queryResult(wallet === 'tg_777004' ? null : null);
  Player.prototype.save = async function save() { return this; };
  PlayerUpgrades.findOne = () => queryResult(null);

  const createRes = await fetch(`${baseUrl}/api/donations/stars/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.53' },
    body: JSON.stringify({ productKey: 'basic_pack', telegramInitData: initData })
  });

  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  const payment = donationPayments.find((item) => item.paymentId === created.orderId);

  const webhookPayload = {
    update_id: 2,
    pre_checkout_query: {
      id: 'pre-checkout-1',
      from: { id: 777004 },
      currency: 'XTR',
      total_amount: payment.starsAmount,
      invoice_payload: payment.invoicePayload
    }
  };

  const res = await fetch(`${baseUrl}/api/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': process.env.TELEGRAM_WEBHOOK_SECRET
    },
    body: JSON.stringify(webhookPayload)
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.type, 'pre_checkout_query');
  assert.equal(body.result.ok, true);
  assert.equal(body.result.orderId, created.orderId);

  await server.close();
});

test('POST /api/telegram/webhook processes successful_payment idempotently', async () => {
  process.env.TELEGRAM_BOT_TOKEN = '123456:stars-token';
  const { server, baseUrl } = await startServer();
  const initData = buildTelegramInitData({ id: 888002, first_name: 'Buyer' }, process.env.TELEGRAM_BOT_TOKEN);

  let player = { wallet: 'tg_888002', totalGoldCoins: 0, totalSilverCoins: 0, save: async function save() { return this; } };
  Player.findOne = ({ wallet }) => queryResult(wallet === 'tg_888002' ? player : null);
  Player.prototype.save = async function save() { player = this; return this; };
  PlayerUpgrades.findOne = () => queryResult(null);

  const createRes = await fetch(`${baseUrl}/api/donations/stars/create`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '203.0.113.22'
    },
    body: JSON.stringify({ productKey: 'starter_pack', telegramInitData: initData })
  });
  const created = await createRes.json();
  const payment = donationPayments.find((item) => item.paymentId === created.orderId);

  const webhookPayload = {
    update_id: 1,
    message: {
      successful_payment: {
        currency: 'XTR',
        total_amount: payment.starsAmount,
        invoice_payload: payment.invoicePayload,
        telegram_payment_charge_id: 'tg-charge-1'
      }
    }
  };

  const first = await fetch(`${baseUrl}/api/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': process.env.TELEGRAM_WEBHOOK_SECRET
    },
    body: JSON.stringify(webhookPayload)
  });
  assert.equal(first.status, 200);

  const second = await fetch(`${baseUrl}/api/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': process.env.TELEGRAM_WEBHOOK_SECRET
    },
    body: JSON.stringify(webhookPayload)
  });
  assert.equal(second.status, 200);

  const updated = donationPayments.find((item) => item.paymentId === created.orderId);
  assert.equal(updated.status, 'paid');
  assert.equal(updated.telegramPaymentChargeId, 'tg-charge-1');
  assert.ok(updated.paidAt);
  assert.ok(updated.rewardGrantedAt);
  assert.equal(player.totalGoldCoins, 400);
  assert.equal(player.totalSilverCoins, 400);

  const historyRes = await fetch(`${baseUrl}/api/store/donations/history/tg_888002`);
  assert.equal(historyRes.status, 200);
  const history = await historyRes.json();
  assert.equal(history.payments[0].paymentMethod, 'telegram-stars');
  assert.equal(history.payments[0].paymentProvider, 'telegram');
  assert.equal(history.payments[0].paymentCategory, 'stars');
  assert.equal(history.payments[0].status, 'paid');
  assert.equal(history.payments[0].starsAmount, 100);
  assert.equal(history.payments[0].amount, 100);
  assert.equal(history.payments[0].paymentAmount, 100);
  assert.equal(history.payments[0].amountValue, '100');
  assert.equal(history.payments[0].currency, 'STARS');
  assert.deepEqual(history.payments[0].payment, {
    method: 'telegram-stars',
    provider: 'telegram',
    category: 'stars',
    amount: 100,
    amountValue: '100',
    currency: 'STARS',
    amountByMethod: 100,
    unit: 'STARS'
  });
  assert.equal(history.payments[0].paymentMethodLegacy, 'telegram_stars');

  await server.close();
});

test('POST /api/account/auth/telegram requires valid Telegram init data', async () => {
  process.env.TELEGRAM_BOT_TOKEN = '123456:stars-token';
  const { server, baseUrl } = await startServer();

  const invalid = await fetch(`${baseUrl}/api/account/auth/telegram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ telegramId: '777001' })
  });

  assert.equal(invalid.status, 401);

  const initData = buildTelegramInitData({ id: 777001, first_name: 'Auth' }, process.env.TELEGRAM_BOT_TOKEN);
  const valid = await fetch(`${baseUrl}/api/account/auth/telegram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ telegramInitData: initData })
  });

  assert.equal(valid.status, 200);
  const body = await valid.json();
  assert.equal(body.success, true);
  assert.equal(body.telegramId, '777001');

  await server.close();
});

test('POST /api/telegram/webhook rejects requests with missing or invalid secret', async () => {
  process.env.TELEGRAM_BOT_TOKEN = '123456:stars-token';

  const { server, baseUrl } = await startServer();

  const missingSecret = await fetch(`${baseUrl}/api/telegram/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ update_id: 1 })
  });
  assert.equal(missingSecret.status, 401);

  const invalidSecret = await fetch(`${baseUrl}/api/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': 'wrong-secret'
    },
    body: JSON.stringify({ update_id: 2 })
  });
  assert.equal(invalidSecret.status, 401);

  const querySecret = await fetch(`${baseUrl}/api/telegram/webhook?secret=${process.env.TELEGRAM_WEBHOOK_SECRET}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ update_id: 99 })
  });
  assert.equal(querySecret.status, 401);

  const validSecret = await fetch(`${baseUrl}/api/telegram/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': process.env.TELEGRAM_WEBHOOK_SECRET
    },
    body: JSON.stringify({ update_id: 3 })
  });
  assert.equal(validSecret.status, 200);

  process.env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret';
  await server.close();
});

test('POST /api/telegram/webhook returns 503 when TELEGRAM_WEBHOOK_SECRET is not configured', async () => {
  const originalSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  let server;

  try {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const started = await startServer();
    server = started.server;
    const { baseUrl } = started;

    const res = await fetch(`${baseUrl}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update_id: 999 })
    });

    assert.equal(res.status, 503);
    const body = await res.json();
    assert.match(body.error, /not configured/i);
  } finally {
    if (originalSecret) {
      process.env.TELEGRAM_WEBHOOK_SECRET = originalSecret;
    }
    if (server) {
      await server.close();
    }
  }
});

test('POST /api/account/link/request-code does not log plaintext verification code', async () => {
  const logger = require('../utils/logger');
  const originalInfo = logger.info;
  const originalDeleteMany = LinkCode.deleteMany;
  const originalFindOne = LinkCode.findOne;

  const logged = [];
  let server;

  try {
    logger.info = (payload, message) => {
      if (message === 'Link code generated') {
        logged.push(payload);
      }
    };

    LinkCode.deleteMany = async () => ({ deletedCount: 0 });
    LinkCode.findOne = async () => null;
    LinkCode.prototype.save = async function save() { return this; };

    const started = await startServer();
    server = started.server;
    const { baseUrl } = started;

    const wallet = Wallet.createRandom().address.toLowerCase();

    // Seed wallet account directly for deterministic test
    await new AccountLink({ primaryId: wallet, wallet }).save();

    const res = await fetch(`${baseUrl}/api/account/link/request-code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ primaryId: wallet })
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.code);

    assert.ok(logged.length >= 1);
    const latestLog = logged[logged.length - 1] || {};
    assert.equal(Object.prototype.hasOwnProperty.call(latestLog, 'code'), false);
  } finally {
    logger.info = originalInfo;
    LinkCode.deleteMany = originalDeleteMany;
    LinkCode.findOne = originalFindOne;
    if (server) {
      await server.close();
    }
  }
});
