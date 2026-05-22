const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const mongoose = require('mongoose');
const { createApp } = require('../app');

function makeTelegramInitData({ telegramId, botToken, authDate = Math.floor(Date.now() / 1000) }) {
  const user = JSON.stringify({ id: Number(telegramId), first_name: 'Test' });
  const params = new URLSearchParams();
  params.set('auth_date', String(authDate));
  params.set('query_id', 'AAEAAAE');
  params.set('user', user);

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
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

test('mongo readiness guard protects auth endpoints and keeps health/public-config available', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  process.env.ENFORCE_MONGO_READINESS = 'true';
  const originalReadyState = mongoose.connection.readyState;

  try {
    mongoose.connection.readyState = 0;
    const { server, baseUrl } = await startServer();

    const walletStart = Date.now();
    const walletRes = await fetch(`${baseUrl}/api/account/auth/wallet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet: '0x1111111111111111111111111111111111111111', signature: '0xdeadbeef', timestamp: Date.now() })
    });
    const walletElapsedMs = Date.now() - walletStart;
    assert.equal(walletRes.status, 503);
    assert.ok(walletElapsedMs < 500, `expected fast failure, got ${walletElapsedMs}ms`);

    const walletBody = await walletRes.json();
    assert.equal(walletBody.error, 'database_unavailable');

    const telegramStart = Date.now();
    const telegramRes = await fetch(`${baseUrl}/api/account/auth/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ telegramInitData: makeTelegramInitData({ telegramId: 123, botToken: process.env.TELEGRAM_BOT_TOKEN }) })
    });
    const telegramElapsedMs = Date.now() - telegramStart;
    assert.equal(telegramRes.status, 503);
    assert.ok(telegramElapsedMs < 500, `expected fast failure, got ${telegramElapsedMs}ms`);

    const healthRes = await fetch(`${baseUrl}/health`);
    assert.equal(healthRes.status, 200);
    const healthBody = await healthRes.json();
    assert.equal(healthBody.status, 'DEGRADED');
    assert.equal(typeof healthBody.uptime, 'number');
    assert.ok(healthBody.environment);

    const configRes = await fetch(`${baseUrl}/api/public-config`);
    assert.equal(configRes.status, 200);

    await server.close();
  } finally {
    delete process.env.ENFORCE_MONGO_READINESS;
    mongoose.connection.readyState = originalReadyState;
  }
});

test('wallet auth route behaves normally when mongo is ready', async () => {
  const originalReadyState = mongoose.connection.readyState;

  try {
    process.env.ENFORCE_MONGO_READINESS = 'true';
    mongoose.connection.readyState = 1;
    const { server, baseUrl } = await startServer();

    const res = await fetch(`${baseUrl}/api/account/auth/wallet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet: '0x1111111111111111111111111111111111111111', signature: '0xdeadbeef', timestamp: Date.now() })
    });

    assert.notEqual(res.status, 503);
    await server.close();
  } finally {
    delete process.env.ENFORCE_MONGO_READINESS;
    mongoose.connection.readyState = originalReadyState;
  }
});
