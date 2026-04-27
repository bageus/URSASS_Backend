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
    primaryId: 'tg_nick1',
    telegramId: '111',
    wallet: '0xabcdef1234567890abcdef1234567890abcdef12',
    telegramUsername: 'tester',
    ...overrides
  };
}

function makePlayer(overrides = {}) {
  const saved = {};
  return {
    wallet: 'tg_nick1',
    referralCode: 'NICK1234',
    bestScore: 500,
    gold: 0,
    shareStreak: 0,
    lastShareDay: null,
    xUserId: null,
    xUsername: null,
    nickname: null,
    nicknameLower: null,
    leaderboardDisplay: 'wallet',
    save: async function () { Object.assign(saved, this); },
    ...overrides
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('POST /api/account/me/nickname - 401 without auth', async () => {
  const { server, baseUrl } = await startServer();
  try {
    AccountLink.findOne = async () => null;
    const r = await post(baseUrl, '/api/account/me/nickname', { nickname: 'ValidName1' });
    assert.equal(r.status, 401);
  } finally {
    server.close();
  }
});

test('POST /api/account/me/nickname - 200 happy-path', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink();
    AccountLink.findOne = async (q) => {
      if (q.primaryId === 'tg_nick1') return link;
      return null;
    };

    let savedNickname = null;
    let savedNicknameLower = null;
    const player = makePlayer({
      save: async function () {
        savedNickname = this.nickname;
        savedNicknameLower = this.nicknameLower;
      }
    });
    Player.findOne = async (q) => {
      if (q.wallet === 'tg_nick1') return player;
      if (q.nicknameLower) return null; // not taken
      return null;
    };

    const r = await post(baseUrl, '/api/account/me/nickname', { nickname: 'CoolUser42' }, { 'X-Primary-Id': 'tg_nick1' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.equal(r.body.nickname, 'CoolUser42');
    assert.equal(savedNickname, 'CoolUser42');
    assert.equal(savedNicknameLower, 'cooluser42');
  } finally {
    server.close();
  }
});

test('POST /api/account/me/nickname - 400 too short', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink();
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_nick1' ? link : null);
    Player.findOne = async () => makePlayer();

    const r = await post(baseUrl, '/api/account/me/nickname', { nickname: 'ab' }, { 'X-Primary-Id': 'tg_nick1' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid_nickname');
  } finally {
    server.close();
  }
});

test('POST /api/account/me/nickname - 400 too long', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink();
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_nick1' ? link : null);
    Player.findOne = async () => makePlayer();

    const r = await post(baseUrl, '/api/account/me/nickname', { nickname: 'a'.repeat(17) }, { 'X-Primary-Id': 'tg_nick1' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid_nickname');
  } finally {
    server.close();
  }
});

test('POST /api/account/me/nickname - 400 invalid chars', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink();
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_nick1' ? link : null);
    Player.findOne = async () => makePlayer();

    const r = await post(baseUrl, '/api/account/me/nickname', { nickname: 'abc!' }, { 'X-Primary-Id': 'tg_nick1' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid_nickname');
  } finally {
    server.close();
  }
});

test('POST /api/account/me/nickname - 400 reserved word', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink();
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_nick1' ? link : null);
    Player.findOne = async () => makePlayer();

    const r = await post(baseUrl, '/api/account/me/nickname', { nickname: 'Admin' }, { 'X-Primary-Id': 'tg_nick1' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid_nickname');
  } finally {
    server.close();
  }
});

test('POST /api/account/me/nickname - 400 reserved word case-insensitive', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink();
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_nick1' ? link : null);
    Player.findOne = async () => makePlayer();

    const r = await post(baseUrl, '/api/account/me/nickname', { nickname: 'MODERATOR' }, { 'X-Primary-Id': 'tg_nick1' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid_nickname');
  } finally {
    server.close();
  }
});

test('POST /api/account/me/nickname - 409 nickname taken', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink();
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_nick1' ? link : null);

    const player = makePlayer();
    // Another player with the same nicknameLower
    const otherPlayer = makePlayer({ wallet: 'tg_other' });
    Player.findOne = async (q) => {
      if (q.wallet === 'tg_nick1') return player;
      if (q.nicknameLower) return otherPlayer; // already taken
      return null;
    };

    const r = await post(baseUrl, '/api/account/me/nickname', { nickname: 'TakenName' }, { 'X-Primary-Id': 'tg_nick1' });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'nickname_taken');
  } finally {
    server.close();
  }
});
