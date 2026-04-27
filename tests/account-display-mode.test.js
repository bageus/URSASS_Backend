const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../models/Player');
const AccountLink = require('../models/AccountLink');
const { createApp } = require('../app');

// ── Helpers ──────────────────────────────────────────────────────────────────

async function startServer() {
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function post(baseUrl, path, body, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

function makeLink(overrides = {}) {
  return {
    primaryId: 'tg_disp1',
    telegramId: '222',
    wallet: '0xabcdef1234567890abcdef1234567890abcdef12',
    telegramUsername: 'displaytester',
    ...overrides
  };
}

function makePlayer(overrides = {}) {
  return {
    wallet: 'tg_disp1',
    referralCode: 'DISP1234',
    bestScore: 500,
    gold: 0,
    shareStreak: 0,
    lastShareDay: null,
    xUserId: null,
    xUsername: null,
    nickname: 'MyNick',
    nicknameLower: 'mynick',
    leaderboardDisplay: 'wallet',
    save: async function () {},
    ...overrides
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('POST /api/account/me/display-mode - 401 without auth', async () => {
  const { server, baseUrl } = await startServer();
  try {
    AccountLink.findOne = async () => null;
    const r = await post(baseUrl, '/api/account/me/display-mode', { mode: 'wallet' });
    assert.equal(r.status, 401);
  } finally {
    server.close();
  }
});

test('POST /api/account/me/display-mode - 200 wallet mode for wallet user', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink();
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_disp1' ? link : null);

    let savedMode = null;
    const player = makePlayer({
      save: async function () { savedMode = this.leaderboardDisplay; }
    });
    Player.findOne = async () => player;

    const r = await post(baseUrl, '/api/account/me/display-mode', { mode: 'wallet' }, { 'X-Primary-Id': 'tg_disp1' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.equal(r.body.mode, 'wallet');
    assert.equal(savedMode, 'wallet');
  } finally {
    server.close();
  }
});

test('POST /api/account/me/display-mode - 200 nickname mode when nickname is set', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink();
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_disp1' ? link : null);

    let savedMode = null;
    const player = makePlayer({
      nickname: 'MyNick',
      save: async function () { savedMode = this.leaderboardDisplay; }
    });
    Player.findOne = async () => player;

    const r = await post(baseUrl, '/api/account/me/display-mode', { mode: 'nickname' }, { 'X-Primary-Id': 'tg_disp1' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.equal(r.body.mode, 'nickname');
    assert.equal(savedMode, 'nickname');
  } finally {
    server.close();
  }
});

test('POST /api/account/me/display-mode - 200 telegram mode when tg linked with username', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink({ telegramId: '222', telegramUsername: 'displaytester' });
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_disp1' ? link : null);

    let savedMode = null;
    const player = makePlayer({
      save: async function () { savedMode = this.leaderboardDisplay; }
    });
    Player.findOne = async () => player;

    const r = await post(baseUrl, '/api/account/me/display-mode', { mode: 'telegram' }, { 'X-Primary-Id': 'tg_disp1' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.equal(r.body.mode, 'telegram');
    assert.equal(savedMode, 'telegram');
  } finally {
    server.close();
  }
});

test('POST /api/account/me/display-mode - 400 nickname mode when nickname not set', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink();
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_disp1' ? link : null);

    const player = makePlayer({ nickname: null });
    Player.findOne = async () => player;

    const r = await post(baseUrl, '/api/account/me/display-mode', { mode: 'nickname' }, { 'X-Primary-Id': 'tg_disp1' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'nickname_not_set');
  } finally {
    server.close();
  }
});

test('POST /api/account/me/display-mode - 400 wallet mode when wallet not linked', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink({ wallet: null });
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_disp1' ? link : null);

    const player = makePlayer();
    Player.findOne = async () => player;

    const r = await post(baseUrl, '/api/account/me/display-mode', { mode: 'wallet' }, { 'X-Primary-Id': 'tg_disp1' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'wallet_not_linked');
  } finally {
    server.close();
  }
});

test('POST /api/account/me/display-mode - 400 telegram mode when tg not linked', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink({ telegramId: null, telegramUsername: null });
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_disp1' ? link : null);

    const player = makePlayer();
    Player.findOne = async () => player;

    const r = await post(baseUrl, '/api/account/me/display-mode', { mode: 'telegram' }, { 'X-Primary-Id': 'tg_disp1' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'telegram_not_linked');
  } finally {
    server.close();
  }
});

test('POST /api/account/me/display-mode - 400 telegram mode when username missing', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink({ telegramId: '222', telegramUsername: null });
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_disp1' ? link : null);

    const player = makePlayer();
    Player.findOne = async () => player;

    const r = await post(baseUrl, '/api/account/me/display-mode', { mode: 'telegram' }, { 'X-Primary-Id': 'tg_disp1' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'telegram_username_missing');
  } finally {
    server.close();
  }
});

test('POST /api/account/me/display-mode - 400 invalid mode', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink();
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_disp1' ? link : null);

    const player = makePlayer();
    Player.findOne = async () => player;

    const r = await post(baseUrl, '/api/account/me/display-mode', { mode: 'unknown' }, { 'X-Primary-Id': 'tg_disp1' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid_mode');
  } finally {
    server.close();
  }
});
