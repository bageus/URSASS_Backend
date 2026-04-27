const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../models/Player');
const AccountLink = require('../models/AccountLink');
const PlayerRun = require('../models/PlayerRun');
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

async function get(baseUrl, path, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

function makePlayer(overrides = {}) {
  return {
    wallet: 'tg_profile1',
    referralCode: 'PROF1234',
    referredBy: null,
    bestScore: 8350,
    gold: 1240,
    shareStreak: 3,
    lastShareDay: null,
    lastShareAt: null,
    xUserId: null,
    xUsername: null,
    lastSeenRank: null,
    nickname: null,
    leaderboardDisplay: 'wallet',
    save: async function () {},
    ...overrides
  };
}

function makeLink(overrides = {}) {
  return {
    primaryId: 'tg_profile1',
    telegramId: '123',
    wallet: '0xabc',
    telegramUsername: 'vasya',
    ...overrides
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('GET /api/account/me/profile - requires auth', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const r = await get(baseUrl, '/api/account/me/profile');
    assert.equal(r.status, 401);
  } finally {
    server.close();
  }
});

test('GET /api/account/me/profile - returns full profile', async () => {
  const { server, baseUrl } = await startServer();
  try {
    process.env.FRONTEND_BASE_URL = 'https://ursasstube.fun';
    const link = makeLink();
    AccountLink.findOne = async (q) => {
      if (q.primaryId === 'tg_profile1') return link;
      return null;
    };

    const player = makePlayer();
    Player.findOne = async () => player;
    Player.countDocuments = async (q) => {
      if (q?.bestScore?.$gt > 0) return 41; // 41 players better than 8350
      return 100; // total ranked (bestScore > 0)
    };
    PlayerRun.countDocuments = async () => 0;
    PlayerRun.findOne = () => ({ sort: async () => null });

    const r = await get(baseUrl, '/api/account/me/profile', { 'X-Primary-Id': 'tg_profile1' });
    assert.equal(r.status, 200, JSON.stringify(r.body));

    assert.equal(r.body.primaryId, 'tg_profile1');
    assert.equal(r.body.bestScore, 8350);
    assert.equal(r.body.gold, 1240);
    assert.equal(r.body.referralCode, 'PROF1234');
    assert.ok(r.body.referralUrl.includes('PROF1234'), `referralUrl should contain code: ${r.body.referralUrl}`);
    assert.equal(r.body.rank, 42, 'rank = 41 + 1 = 42');
    assert.equal(r.body.totalRankedPlayers, 100);
    assert.equal(r.body.telegram.connected, true);
    assert.equal(r.body.telegram.username, 'vasya');
    assert.equal(r.body.telegram.id, '123');
    assert.equal(r.body.wallet.connected, true);
    assert.equal(r.body.wallet.address, '0xabc');
    assert.equal(r.body.x.connected, false);
    assert.equal(r.body.x.username, null);
    assert.equal(r.body.shareStreak, 3);
    assert.equal(r.body.canShareToday, true);
    assert.ok(typeof r.body.goldRewardToday === 'number');
  } finally {
    delete process.env.FRONTEND_BASE_URL;
    server.close();
  }
});

test('GET /api/account/me/profile - canShareToday false when already shared today', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const today = new Date().toISOString().slice(0, 10);
    const link = makeLink({ primaryId: 'tg_today', telegramId: '200', wallet: '0xdef' });
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_today' ? link : null);

    Player.findOne = async () => makePlayer({ wallet: 'tg_today', lastShareDay: today, shareStreak: 2 });
    Player.countDocuments = async () => 0;
    PlayerRun.countDocuments = async () => 0;
    PlayerRun.findOne = () => ({ sort: async () => null });

    const r = await get(baseUrl, '/api/account/me/profile', { 'X-Primary-Id': 'tg_today' });
    assert.equal(r.status, 200);
    assert.equal(r.body.canShareToday, false);
  } finally {
    server.close();
  }
});

test('GET /api/account/me/profile - shareStreak shown as 0 when streak is stale (2+ days ago)', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const link = makeLink({ primaryId: 'tg_stale', telegramId: '300', wallet: '0xghi' });
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_stale' ? link : null);

    Player.findOne = async () => makePlayer({
      wallet: 'tg_stale',
      lastShareDay: twoDaysAgo,
      shareStreak: 5
    });
    Player.countDocuments = async () => 0;
    PlayerRun.countDocuments = async () => 0;
    PlayerRun.findOne = () => ({ sort: async () => null });

    const r = await get(baseUrl, '/api/account/me/profile', { 'X-Primary-Id': 'tg_stale' });
    assert.equal(r.status, 200);
    assert.equal(r.body.shareStreak, 0, 'Stale streak should display as 0');
    assert.equal(r.body.canShareToday, true);
    assert.equal(r.body.lastShareDay, twoDaysAgo);
  } finally {
    server.close();
  }
});

test('GET /api/account/me/profile - referralUrl is consistent', async () => {
  const { server, baseUrl } = await startServer();
  try {
    process.env.FRONTEND_BASE_URL = 'https://example.com';
    const link = makeLink({ primaryId: 'tg_url', telegramId: '400', wallet: null });
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_url' ? link : null);

    Player.findOne = async () => makePlayer({ wallet: 'tg_url', referralCode: 'URL12345' });
    Player.countDocuments = async () => 0;
    PlayerRun.countDocuments = async () => 0;
    PlayerRun.findOne = () => ({ sort: async () => null });

    const r = await get(baseUrl, '/api/account/me/profile', { 'X-Primary-Id': 'tg_url' });
    assert.equal(r.status, 200);
    assert.equal(r.body.referralUrl, 'https://example.com/?ref=URL12345');
    assert.equal(r.body.referralCode, 'URL12345');
  } finally {
    delete process.env.FRONTEND_BASE_URL;
    server.close();
  }
});

// ── rankDelta tests ──────────────────────────────────────────────────────────

test('rankDelta: init on first read — sets baseline, returns null', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink({ primaryId: 'tg_rank1', telegramId: '501', wallet: '0xrank1' });
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_rank1' ? link : null);

    let savedLastSeenRank;
    const player = makePlayer({
      wallet: 'tg_rank1',
      bestScore: 8350,
      lastSeenRank: null,
      save: async function () { savedLastSeenRank = this.lastSeenRank; }
    });
    Player.findOne = async () => player;
    Player.countDocuments = async (q) => {
      if (q?.bestScore?.$gt > 0) return 41;
      return 100;
    };
    PlayerRun.countDocuments = async () => 0;
    PlayerRun.findOne = () => ({ sort: async () => null });

    const r = await get(baseUrl, '/api/account/me/profile', { 'X-Primary-Id': 'tg_rank1' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.rankDelta, null, 'rankDelta should be null on first read');
    assert.equal(savedLastSeenRank, 42, 'lastSeenRank should be set to current rank on first read');
  } finally {
    server.close();
  }
});

test('rankDelta: stable across multiple reads — baseline not overwritten', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink({ primaryId: 'tg_rank2', telegramId: '502', wallet: '0xrank2' });
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_rank2' ? link : null);

    let saveCallCount = 0;
    const player = makePlayer({
      wallet: 'tg_rank2',
      bestScore: 8350,
      lastSeenRank: 42,
      save: async function () { saveCallCount++; }
    });
    Player.findOne = async () => player;
    // 49 players better → rank 50
    Player.countDocuments = async (q) => {
      if (q?.bestScore?.$gt > 0) return 49;
      return 100;
    };
    PlayerRun.countDocuments = async () => 0;
    PlayerRun.findOne = () => ({ sort: async () => null });

    const r1 = await get(baseUrl, '/api/account/me/profile', { 'X-Primary-Id': 'tg_rank2' });
    assert.equal(r1.status, 200);
    assert.equal(r1.body.rankDelta, 8, 'first read: rankDelta = 50 - 42 = 8');

    const r2 = await get(baseUrl, '/api/account/me/profile', { 'X-Primary-Id': 'tg_rank2' });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.rankDelta, 8, 'second read: rankDelta still 8, baseline unchanged');
    assert.equal(saveCallCount, 0, 'save() should not be called when baseline is already set');
    assert.equal(player.lastSeenRank, 42, 'lastSeenRank must not be overwritten on reads');
  } finally {
    server.close();
  }
});

test('rankDelta: no update for non-wallet user', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink({ primaryId: 'tg_rank3', telegramId: '503', wallet: null });
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_rank3' ? link : null);

    let saveCallCount = 0;
    const player = makePlayer({
      wallet: 'tg_rank3',
      bestScore: 8350,
      lastSeenRank: null,
      save: async function () { saveCallCount++; }
    });
    Player.findOne = async () => player;
    Player.countDocuments = async (q) => {
      if (q?.bestScore?.$gt > 0) return 41;
      return 100;
    };
    PlayerRun.countDocuments = async () => 0;
    PlayerRun.findOne = () => ({ sort: async () => null });

    const r = await get(baseUrl, '/api/account/me/profile', { 'X-Primary-Id': 'tg_rank3' });
    assert.equal(r.status, 200);
    assert.equal(r.body.rankDelta, null, 'rankDelta must be null for non-wallet user');
    assert.equal(saveCallCount, 0, 'save() must not be called for non-wallet user');
    assert.equal(player.lastSeenRank, null, 'lastSeenRank must not be touched for non-wallet user');
  } finally {
    server.close();
  }
});

test('rankDelta: negative delta when player rose in rank', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink({ primaryId: 'tg_rank4', telegramId: '504', wallet: '0xrank4' });
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_rank4' ? link : null);

    const player = makePlayer({
      wallet: 'tg_rank4',
      bestScore: 9000,
      lastSeenRank: 50,
      save: async function () {}
    });
    Player.findOne = async () => player;
    // 41 players better → rank 42 (rose from 50 to 42)
    Player.countDocuments = async (q) => {
      if (q?.bestScore?.$gt > 0) return 41;
      return 100;
    };
    PlayerRun.countDocuments = async () => 0;
    PlayerRun.findOne = () => ({ sort: async () => null });

    const r = await get(baseUrl, '/api/account/me/profile', { 'X-Primary-Id': 'tg_rank4' });
    assert.equal(r.status, 200);
    assert.equal(r.body.rankDelta, -8, 'rankDelta = 42 - 50 = -8 (rose 8 places)');
  } finally {
    server.close();
  }
});

// ── referralCount tests ──────────────────────────────────────────────────────

test('GET /api/account/me/profile - referralCount reflects number of referred players', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink({ primaryId: 'tg_refcount', telegramId: '601', wallet: '0xrefcount' });
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_refcount' ? link : null);

    Player.findOne = async () => makePlayer({ wallet: 'tg_refcount', referralCode: 'ABC123' });
    Player.countDocuments = async (q) => {
      if (q?.referredBy === 'ABC123') return 7;
      if (q?.bestScore?.$gt > 0) return 41;
      return 100;
    };
    PlayerRun.countDocuments = async () => 0;
    PlayerRun.findOne = () => ({ sort: async () => null });

    const r = await get(baseUrl, '/api/account/me/profile', { 'X-Primary-Id': 'tg_refcount' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.referralCount, 7, 'referralCount should be 7');
  } finally {
    server.close();
  }
});

test('GET /api/account/me/profile - referralCount is 0 when no referralCode', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = makeLink({ primaryId: 'tg_nocode', telegramId: '602', wallet: '0xnocode' });
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_nocode' ? link : null);

    Player.findOne = async () => makePlayer({ wallet: 'tg_nocode', referralCode: null });
    Player.countDocuments = async (q) => {
      if (q?.bestScore?.$gt > 0) return 0;
      return 0;
    };
    PlayerRun.countDocuments = async () => 0;
    PlayerRun.findOne = () => ({ sort: async () => null });

    const r = await get(baseUrl, '/api/account/me/profile', { 'X-Primary-Id': 'tg_nocode' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.referralCount, 0, 'referralCount should be 0 when no referralCode');
  } finally {
    server.close();
  }
});
