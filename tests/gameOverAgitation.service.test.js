const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../models/Player');
const {
  buildAgitationPrompt,
  buildGameOverPayload,
  buildGameOverLeaderboardSlice,
  resolvePersonalBestHook
} = require('../services/gameOverAgitationService');
const mongoose = require('mongoose');

test('buildAgitationPrompt returns NEW LEADER for #1 rank', () => {
  const prompt = buildAgitationPrompt({
    rank: 1,
    run: { isFirstRun: false, isPersonalBest: true, score: 1200 },
    previousBestScore: 1000,
    recommendedTarget: null,
    top1Delta: null,
    top3Delta: null,
    nextRankDelta: null,
    percentileFirstRunScore: null,
    isAuthenticated: true
  });

  assert.equal(prompt.title, '👑 NEW LEADER!');
  assert.equal(prompt.boost, null);
});

test('buildAgitationPrompt returns TOP 3 message and delta to #1', () => {
  const prompt = buildAgitationPrompt({
    rank: 2,
    run: { isFirstRun: false, isPersonalBest: true, score: 900 },
    previousBestScore: 850,
    recommendedTarget: null,
    top1Delta: 120,
    top3Delta: 20,
    nextRankDelta: 10,
    percentileFirstRunScore: null,
    isAuthenticated: true
  });

  assert.equal(prompt.title, '💥 YOU MADE IT TO TOP 3!');
  assert.equal(prompt.boost, 'Next +120 to #1');
});

test('buildAgitationPrompt for personal best in top 1000', () => {
  const prompt = buildAgitationPrompt({
    rank: 650,
    run: { isFirstRun: false, isPersonalBest: true, score: 450 },
    previousBestScore: 400,
    recommendedTarget: null,
    top1Delta: null,
    top3Delta: null,
    nextRankDelta: 88,
    percentileFirstRunScore: null,
    isAuthenticated: true
  });

  assert.equal(prompt.title, 'PERSONAL BEST!');
  assert.equal(prompt.hook, 'You reached TOP 1000');
  assert.equal(prompt.boost, '+88 points to pass the next player');
});

test('buildAgitationPrompt for unauthenticated run', () => {
  const prompt = buildAgitationPrompt({
    rank: 12345,
    run: { isFirstRun: false, isPersonalBest: false, score: 200 },
    previousBestScore: 0,
    recommendedTarget: null,
    top1Delta: null,
    top3Delta: null,
    nextRankDelta: 100,
    percentileFirstRunScore: 68,
    isAuthenticated: false
  });

  assert.equal(prompt.title, 'GOOD RUN!');
  assert.equal(prompt.hook, '🔥WOW! You would be #12345');
  assert.match(prompt.boost, /Better than 68% of new players/);
});

test('resolvePersonalBestHook maps rank buckets', () => {
  assert.equal(resolvePersonalBestHook(50), 'You’re in TOP 100!');
  assert.equal(resolvePersonalBestHook(500), 'You’re in TOP 1000!');
  assert.equal(resolvePersonalBestHook(5000), 'You’re in TOP 10000!');
});

test('buildGameOverLeaderboardSlice returns player context rows with dim flags', async () => {
  Player.find = () => ({
    sort() { return this; },
    skip() { return this; },
    limit() { return this; },
    select() {
      return Promise.resolve([
        { wallet: '0x100', bestScore: 1000 },
        { wallet: '0x101', bestScore: 990 },
        { wallet: '0x102', bestScore: 980 }
      ]);
    }
  });

  const slice = await buildGameOverLeaderboardSlice(101);
  assert.equal(slice.mode, 'around_player');
  assert.equal(slice.rows.length, 3);
  assert.equal(slice.rows[1].isCurrentPlayerRow, true);
  assert.equal(slice.rows[0].isDimmed, true);
  assert.equal(slice.rows[2].isDimmed, true);
});


test('buildGameOverPayload computes #1 delta from leaderboard score, not weaker current run', async () => {
  const originalFind = Player.find;
  const originalReadyState = mongoose.connection.readyState;

  Player.find = () => {
    const query = {
      _skip: 0,
      _limit: 0,
      sort() { return this; },
      skip(value) { this._skip = value; return this; },
      limit(value) { this._limit = value; return this; },
      select() {
        if (this._limit === 1) {
          const rank = this._skip + 1;
          const map = {
            1: { wallet: '0x1', bestScore: 1000 },
            3: { wallet: '0x3', bestScore: 900 }
          };
          return Promise.resolve([map[rank]].filter(Boolean));
        }

        return Promise.resolve([
          { wallet: '0x1', bestScore: 1000 },
          { wallet: '0x2', bestScore: 950 },
          { wallet: '0x3', bestScore: 900 }
        ]);
      }
    };

    return query;
  };

  mongoose.connection.readyState = 1;

  const payload = await buildGameOverPayload({
    insights: { rank: 2, recommendedTarget: null },
    run: { score: 600, isFirstRun: false, isPersonalBest: false },
    previousBestScore: 950,
    isAuthenticated: true
  });

  assert.equal(payload.boost, 'Next +51 to #1');

  Player.find = originalFind;
  mongoose.connection.readyState = originalReadyState;
});
