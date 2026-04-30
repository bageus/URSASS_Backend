const test = require('node:test');
const assert = require('node:assert/strict');

const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';

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

async function getLeaderboardTop(baseUrl) {
  const res = await fetch(`${baseUrl}/api/leaderboard/top`);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

function makeChainableFind(result) {
  const arr = Array.isArray(result) ? result : (result ? [result] : []);
  return {
    sort() { return this; },
    limit() { return this; },
    select() { return Promise.resolve(arr); },
    then(resolve, reject) { return Promise.resolve(arr).then(resolve, reject); }
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GET /api/leaderboard/top - wallet-linked player with leaderboardDisplay:telegram shows @username', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const evmWallet = '0xaabbccddeeff001122334455667788990011aabb';

    // Player has an EVM wallet address as their Player.wallet
    const player = {
      wallet: evmWallet,
      bestScore: 5000,
      bestDistance: 100,
      averageScore: 3000,
      scoreToAverageRatio: null,
      totalGoldCoins: 10,
      totalSilverCoins: 5,
      gamesPlayed: 3,
      nickname: null,
      leaderboardDisplay: 'telegram'
    };

    // AccountLink has primaryId = tg_42 (TG-first user) but wallet = evmWallet
    const link = {
      primaryId: 'tg_42',
      telegramId: '42',
      telegramUsername: 'vasya',
      wallet: evmWallet
    };

    Player.find = () => makeChainableFind(player);
    Player.findOne = async () => null;
    Player.countDocuments = async () => 0;

    // AccountLink.find must return link when queried by wallet or primaryId
    AccountLink.find = async (query) => {
      const inValues = query?.$or?.flatMap(c => {
        if (c.primaryId) return c.primaryId.$in || [];
        if (c.wallet) return c.wallet.$in || [];
        return [];
      }) || [];
      if (inValues.includes(evmWallet) || inValues.includes('tg_42')) {
        return [link];
      }
      return [];
    };

    PlayerRun.findOne = () => ({ sort: async () => null });

    const r = await getLeaderboardTop(baseUrl);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.leaderboard.length, 1);
    assert.equal(r.body.leaderboard[0].displayName, '@vasya',
      `Expected '@vasya' but got '${r.body.leaderboard[0].displayName}'`);
  } finally {
    server.close();
  }
});

test('GET /api/leaderboard/top - telegram-only player with leaderboardDisplay:telegram shows @username', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const tgPrimaryId = 'tg_42';

    const player = {
      wallet: tgPrimaryId,
      bestScore: 4000,
      bestDistance: 80,
      averageScore: 2500,
      scoreToAverageRatio: null,
      totalGoldCoins: 5,
      totalSilverCoins: 2,
      gamesPlayed: 2,
      nickname: null,
      leaderboardDisplay: 'telegram'
    };

    const link = {
      primaryId: tgPrimaryId,
      telegramId: '42',
      telegramUsername: 'vasya',
      wallet: null
    };

    Player.find = () => makeChainableFind(player);
    Player.findOne = async () => null;
    Player.countDocuments = async () => 0;

    AccountLink.find = async (query) => {
      const inValues = query?.$or?.flatMap(c => {
        if (c.primaryId) return c.primaryId.$in || [];
        if (c.wallet) return c.wallet.$in || [];
        return [];
      }) || [];
      if (inValues.includes(tgPrimaryId)) {
        return [link];
      }
      return [];
    };

    PlayerRun.findOne = () => ({ sort: async () => null });

    const r = await getLeaderboardTop(baseUrl);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.leaderboard.length, 1);
    assert.equal(r.body.leaderboard[0].displayName, '@vasya',
      `Expected '@vasya' but got '${r.body.leaderboard[0].displayName}'`);
  } finally {
    server.close();
  }
});

test('GET /api/leaderboard/top - player with leaderboardDisplay:nickname shows nickname', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const evmWallet = '0xaabbccddeeff001122334455667788990011aabb';

    const player = {
      wallet: evmWallet,
      bestScore: 6000,
      bestDistance: 120,
      averageScore: 4000,
      scoreToAverageRatio: null,
      totalGoldCoins: 15,
      totalSilverCoins: 8,
      gamesPlayed: 5,
      nickname: 'CoolPlayer',
      leaderboardDisplay: 'nickname'
    };

    Player.find = () => makeChainableFind(player);
    Player.findOne = async () => null;
    Player.countDocuments = async () => 0;
    AccountLink.find = async () => [];

    PlayerRun.findOne = () => ({ sort: async () => null });

    const r = await getLeaderboardTop(baseUrl);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.leaderboard.length, 1);
    assert.equal(r.body.leaderboard[0].displayName, 'CoolPlayer',
      `Expected 'CoolPlayer' but got '${r.body.leaderboard[0].displayName}'`);
  } finally {
    server.close();
  }
});

process.on('exit', () => {
  process.env.NODE_ENV = originalNodeEnv;
});
