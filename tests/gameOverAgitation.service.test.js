const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../models/Player');
const {
  buildAgitationPrompt,
  buildGameOverLeaderboardSlice,
  resolvePersonalBestHook
} = require('../services/gameOverAgitationService');

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
  assert.equal(prompt.hook, 'You’re in TOP 1000!');
  assert.equal(prompt.boost, '+88 points to break in');
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
  assert.equal(prompt.hook, 'You’re playing in practice mode');
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
