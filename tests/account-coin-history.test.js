const test = require('node:test');
const assert = require('node:assert/strict');

const AccountLink = require('../models/AccountLink');
const CoinTransaction = require('../models/CoinTransaction');
const { createApp } = require('../app');

async function startServer() {
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function get(baseUrl, path, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

test('GET /api/account/me/coin-history - requires auth', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const r = await get(baseUrl, '/api/account/me/coin-history');
    assert.equal(r.status, 401);
  } finally {
    server.close();
  }
});

test('GET /api/account/me/coin-history - returns wallet-saved rows for wallet auth', async () => {
  const { server, baseUrl } = await startServer();
  const originalFindOne = AccountLink.findOne;
  const originalFind = CoinTransaction.find;
  try {
    AccountLink.findOne = async (q) => {
      if (q.wallet === '0xabc') return { primaryId: '0xabc', wallet: '0xabc', telegramId: null };
      return null;
    };

    CoinTransaction.find = (query) => {
      assert.deepEqual(query, { primaryId: { $in: ['0xabc'] } });
      return {
        sort: () => ({
          limit: (value) => {
            assert.equal(value, 50);
            return {
              select: async () => ([
                { type: 'ride', gold: 5, silver: 3, createdAt: new Date('2026-04-28T09:00:00Z') }
              ])
            };
          }
        })
      };
    };

    const r = await get(baseUrl, '/api/account/me/coin-history', { 'X-Wallet': '0xAbC' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.items.length, 1);
    assert.equal(r.body.items[0].type, 'ride');
  } finally {
    AccountLink.findOne = originalFindOne;
    CoinTransaction.find = originalFind;
    server.close();
  }
});

test('GET /api/account/me/coin-history - returns wallet-saved rows for linked Telegram auth primaryId', async () => {
  const { server, baseUrl } = await startServer();
  const originalFindOne = AccountLink.findOne;
  const originalFind = CoinTransaction.find;
  try {
    AccountLink.findOne = async (q) => {
      if (q.primaryId === 'tg_777') return { primaryId: 'tg_777', wallet: '0xabc', telegramId: '777' };
      return null;
    };

    CoinTransaction.find = (query) => {
      assert.deepEqual(query, { primaryId: { $in: ['tg_777', '0xabc'] } });
      return {
        sort: () => ({
          limit: () => ({
            select: async () => ([
              { type: 'onboarding_bonus', gold: 100, silver: 0, createdAt: new Date('2026-04-28T10:00:00Z') }
            ])
          })
        })
      };
    };

    const r = await get(baseUrl, '/api/account/me/coin-history', { 'X-Primary-Id': 'tg_777' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.items.length, 1);
    assert.equal(r.body.items[0].type, 'onboarding_bonus');
  } finally {
    AccountLink.findOne = originalFindOne;
    CoinTransaction.find = originalFind;
    server.close();
  }
});

test('GET /api/account/me/coin-history - empty history returns items array', async () => {
  const { server, baseUrl } = await startServer();
  const originalFindOne = AccountLink.findOne;
  const originalFind = CoinTransaction.find;
  try {
    AccountLink.findOne = async (q) => {
      if (q.primaryId === 'tg_empty') return { primaryId: 'tg_empty', wallet: null, telegramId: '555' };
      return null;
    };

    CoinTransaction.find = (query) => {
      assert.deepEqual(query, { primaryId: { $in: ['tg_empty'] } });
      return {
        sort: () => ({
          limit: () => ({
            select: async () => ([])
          })
        })
      };
    };

    const r = await get(baseUrl, '/api/account/me/coin-history', { 'X-Primary-Id': 'tg_empty' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body, { items: [] });
  } finally {
    AccountLink.findOne = originalFindOne;
    CoinTransaction.find = originalFind;
    server.close();
  }
});
