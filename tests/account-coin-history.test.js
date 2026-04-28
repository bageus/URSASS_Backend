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

test('GET /api/account/me/coin-history - returns rows with default limit', async () => {
  const { server, baseUrl } = await startServer();
  try {
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_hist1'
      ? { primaryId: 'tg_hist1', telegramId: '1', wallet: null }
      : null);

    CoinTransaction.find = (query) => {
      assert.equal(query.primaryId, 'tg_hist1');
      return {
        sort: () => ({
          limit: (value) => {
            assert.equal(value, 50);
            return {
              select: async () => ([
                { type: 'share', gold: 20, silver: 0, createdAt: new Date('2026-04-28T10:00:00Z') },
                { type: 'ride', gold: 5, silver: 3, createdAt: new Date('2026-04-28T09:00:00Z') }
              ])
            };
          }
        })
      };
    };

    const r = await get(baseUrl, '/api/account/me/coin-history', { 'X-Primary-Id': 'tg_hist1' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(Array.isArray(r.body.items), true);
    assert.equal(r.body.items.length, 2);
    assert.equal(r.body.items[0].type, 'share');
    assert.equal(r.body.items[1].silver, 3);
  } finally {
    server.close();
  }
});
