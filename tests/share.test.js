const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const Player = require('../models/Player');
const AccountLink = require('../models/AccountLink');
const ShareEvent = require('../models/ShareEvent');
const CoinTransaction = require('../models/CoinTransaction');
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

function makePlayer(overrides = {}) {
  return {
    wallet: 'tg_player1',
    referralCode: 'PLAY1234',
    referredBy: null,
    bestScore: 500,
    gold: 0,
    shareStreak: 0,
    lastShareDay: null,
    lastShareAt: null,
    save: async function() { return this; },
    ...overrides
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('POST /api/share/start - requires auth', async () => {
  const { server, baseUrl } = await startServer();
  try {
    AccountLink.findOne = async () => null;
    const r = await post(baseUrl, '/api/share/start', {});
    assert.equal(r.status, 401);
  } finally {
    server.close();
  }
});

test('POST /api/share/start - returns shareId when eligible', async () => {
  const { server, baseUrl } = await startServer();
  try {
    process.env.FRONTEND_BASE_URL = 'https://ursasstube.fun';
    const link = { primaryId: 'tg_player1', telegramId: '1', wallet: null };
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_player1' ? link : null);
    Player.findOne = async () => makePlayer();

    const created = [];
    ShareEvent.create = async (doc) => {
      created.push(doc);
      return { ...doc };
    };

    const r = await post(baseUrl, '/api/share/start', {}, { 'X-Primary-Id': 'tg_player1' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.shareId, 'shareId should be present');
    assert.ok(r.body.eligibleForReward === true);
    assert.ok(r.body.secondsUntilReward > 0);
    assert.equal(created.length, 1);
  } finally {
    delete process.env.FRONTEND_BASE_URL;
    server.close();
  }
});

test('POST /api/share/start - wallet-linked share contains preview URL and tweet URL with page', async () => {
  const { server, baseUrl } = await startServer();
  try {
    process.env.FRONTEND_BASE_URL = 'https://ursasstube.fun';
    const wallet = '0x1111111111111111111111111111111111111111';
    const link = { primaryId: 'tg_player3', telegramId: '3', wallet };
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_player3' ? link : null);
    Player.findOne = async () => makePlayer({ wallet: 'tg_player3' });
    ShareEvent.create = async (doc) => ({ ...doc });

    const r = await post(baseUrl, '/api/share/start', {}, { 'X-Primary-Id': 'tg_player3' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.imageUrl, `${baseUrl}/api/leaderboard/share/image/${wallet}.png`);
    assert.equal(r.body.previewUrl, `${baseUrl}/api/leaderboard/share/page/${wallet}`);
    assert.match(r.body.intentUrl, /twitter\.com\/intent\/tweet\?/);
    assert.match(r.body.intentUrl, /&url=/);
  } finally {
    delete process.env.FRONTEND_BASE_URL;
    server.close();
  }
});

test('POST /api/share/start - already_shared_today returns no shareId', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const today = new Date().toISOString().slice(0, 10);
    const link = { primaryId: 'tg_player2', telegramId: '2', wallet: null };
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_player2' ? link : null);
    Player.findOne = async () => makePlayer({ wallet: 'tg_player2', lastShareDay: today });
    ShareEvent.create = async () => ({});

    const r = await post(baseUrl, '/api/share/start', {}, { 'X-Primary-Id': 'tg_player2' });
    assert.equal(r.status, 200);
    assert.equal(r.body.shareId, null);
    assert.equal(r.body.reason, 'already_shared_today');
  } finally {
    server.close();
  }
});

test('POST /api/share/confirm - 425 when confirmed too early', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const shareId = crypto.randomUUID();
    const link = { primaryId: 'tg_early', telegramId: '3', wallet: null };
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_early' ? link : null);
    Player.findOne = async () => makePlayer({ wallet: 'tg_early' });

    const event = {
      primaryId: 'tg_early',
      shareId,
      startedAt: new Date(), // just now — not 30s elapsed
      confirmedAt: null,
      goldAwarded: 0
    };
    ShareEvent.findOne = async (q) => {
      if (q.shareId === shareId && q.primaryId === 'tg_early') return event;
      return null;
    };
    ShareEvent.findOneAndUpdate = async () => null;

    const r = await post(baseUrl, '/api/share/confirm', { shareId }, { 'X-Primary-Id': 'tg_early' });
    assert.equal(r.status, 425, JSON.stringify(r.body));
    assert.equal(r.body.error, 'too_early');
    assert.ok(r.body.secondsLeft > 0);
  } finally {
    server.close();
  }
});

test('POST /api/share/confirm - awards 20 gold after 30s', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const shareId = crypto.randomUUID();
    const link = { primaryId: 'tg_gold', telegramId: '4', wallet: null };
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_gold' ? link : null);

    const player = makePlayer({ wallet: 'tg_gold', gold: 0, shareStreak: 0, lastShareDay: null });
    Player.findOne = async () => ({ ...player, save: player.save });
    Player.findOneAndUpdate = async (q, update) => {
      player.gold = (player.gold || 0) + (update.$inc?.gold || 0);
      return player;
    };

    const event = {
      primaryId: 'tg_gold',
      shareId,
      startedAt: new Date(Date.now() - 35000), // 35s ago
      confirmedAt: null,
      goldAwarded: 0
    };
    ShareEvent.findOne = async (q) => {
      if (q.shareId === shareId) return event;
      if (q.primaryId === 'tg_gold' && q.dayKey) return null; // no prior reward today
      return null;
    };
    ShareEvent.findOneAndUpdate = async (q, update, opts) => {
      if (q.shareId === shareId && q.confirmedAt === null) {
        Object.assign(event, update.$set);
        return event;
      }
      return null;
    };
    let historyDoc = null;
    CoinTransaction.create = async (doc) => {
      historyDoc = doc;
      return doc;
    };

    const r = await post(baseUrl, '/api/share/confirm', { shareId }, { 'X-Primary-Id': 'tg_gold' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.awarded, true);
    assert.equal(r.body.goldAwarded, 20);
    assert.ok(r.body.shareStreak >= 1);
    assert.equal(historyDoc.type, 'share');
    assert.equal(historyDoc.gold, 20);
    assert.equal(historyDoc.silver, 0);
  } finally {
    server.close();
  }
});

test('POST /api/share/confirm - repeat same day returns no reward', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const shareId = crypto.randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    const link = { primaryId: 'tg_repeat', telegramId: '5', wallet: null };
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_repeat' ? link : null);

    const player = makePlayer({ wallet: 'tg_repeat', gold: 20, shareStreak: 1, lastShareDay: today });
    Player.findOne = async () => ({ ...player, save: player.save });

    const event = {
      primaryId: 'tg_repeat',
      shareId,
      startedAt: new Date(Date.now() - 35000),
      confirmedAt: null,
      goldAwarded: 0
    };
    const alreadyRewarded = { primaryId: 'tg_repeat', dayKey: today, goldAwarded: 20 };

    ShareEvent.findOne = async (q) => {
      if (q.shareId === shareId) return event;
      if (q.primaryId === 'tg_repeat' && q.dayKey === today) return alreadyRewarded;
      return null;
    };
    ShareEvent.findOneAndUpdate = async (q, update) => {
      Object.assign(event, update.$set);
      return event;
    };

    const r = await post(baseUrl, '/api/share/confirm', { shareId }, { 'X-Primary-Id': 'tg_repeat' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.awarded, false);
    assert.equal(r.body.reason, 'already_rewarded_today');
  } finally {
    server.close();
  }
});

test('POST /api/share/confirm - streak increments when last share was yesterday', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const shareId = crypto.randomUUID();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const link = { primaryId: 'tg_streak', telegramId: '6', wallet: null };
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_streak' ? link : null);

    const player = makePlayer({
      wallet: 'tg_streak',
      gold: 0,
      shareStreak: 3,
      lastShareDay: yesterday
    });
    Player.findOne = async () => ({ ...player, save: async function() { Object.assign(player, this); return this; } });
    Player.findOneAndUpdate = async (q, update) => {
      player.gold = (player.gold || 0) + (update.$inc?.gold || 0);
      return player;
    };

    const event = {
      primaryId: 'tg_streak',
      shareId,
      startedAt: new Date(Date.now() - 35000),
      confirmedAt: null,
      goldAwarded: 0
    };
    ShareEvent.findOne = async (q) => {
      if (q.shareId === shareId) return event;
      if (q.dayKey) return null;
      return null;
    };
    ShareEvent.findOneAndUpdate = async (q, update, opts) => {
      Object.assign(event, update.$set);
      return event;
    };

    const r = await post(baseUrl, '/api/share/confirm', { shareId }, { 'X-Primary-Id': 'tg_streak' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.awarded, true);
    assert.equal(r.body.shareStreak, 4, 'Streak should increment from 3 to 4');
  } finally {
    server.close();
  }
});

test('POST /api/share/confirm - streak resets to 1 when last share was 2+ days ago', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const shareId = crypto.randomUUID();
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    const link = { primaryId: 'tg_reset', telegramId: '7', wallet: null };
    AccountLink.findOne = async (q) => (q.primaryId === 'tg_reset' ? link : null);

    const player = makePlayer({
      wallet: 'tg_reset',
      gold: 0,
      shareStreak: 5,
      lastShareDay: twoDaysAgo
    });
    Player.findOne = async () => ({ ...player, save: async function() { Object.assign(player, this); return this; } });
    Player.findOneAndUpdate = async (q, update) => {
      player.gold = (player.gold || 0) + (update.$inc?.gold || 0);
      return player;
    };

    const event = {
      primaryId: 'tg_reset',
      shareId,
      startedAt: new Date(Date.now() - 35000),
      confirmedAt: null,
      goldAwarded: 0
    };
    ShareEvent.findOne = async (q) => {
      if (q.shareId === shareId) return event;
      if (q.dayKey) return null;
      return null;
    };
    ShareEvent.findOneAndUpdate = async (q, update, opts) => {
      Object.assign(event, update.$set);
      return event;
    };

    const r = await post(baseUrl, '/api/share/confirm', { shareId }, { 'X-Primary-Id': 'tg_reset' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.awarded, true);
    assert.equal(r.body.shareStreak, 1, 'Streak should reset to 1 after a gap');
  } finally {
    server.close();
  }
});
