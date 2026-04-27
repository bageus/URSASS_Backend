const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../models/Player');
const {
  buildAgitationPrompt,
  buildGameOverLeaderboardSlice,
  computeFirstTimeMilestone
} = require('../services/gameOverAgitationService');
const mongoose = require('mongoose');

// Helper to build a minimal run object
function run(overrides = {}) {
  return { score: 0, isPersonalBest: false, isFirstRun: false, ...overrides };
}

// ── Unauthenticated rules ────────────────────────────────────────────────────

test('U1: unauth, score=500 → TRY AGAIN!', () => {
  const prompt = buildAgitationPrompt({
    rank: null,
    run: run({ score: 500 }),
    previousBestScore: 0,
    isAuthenticated: false
  });
  assert.equal(prompt.title, 'TRY AGAIN!');
  assert.equal(prompt.hook, 'You can do better');
  assert.equal(prompt.boost, 'Save your progress & keep improving');
});

test('U2: unauth, score=2000, wouldBeRank=87 → GOOD RUN! with rank hook', () => {
  const prompt = buildAgitationPrompt({
    rank: null,
    run: run({ score: 2000 }),
    previousBestScore: 0,
    isAuthenticated: false,
    wouldBeRank: 87
  });
  assert.equal(prompt.title, 'GOOD RUN!');
  assert.equal(prompt.hook, '\uD83D\uDD25 You would be #87');
  assert.equal(prompt.boost, 'Save your score & enter leaderboard');
});

test('U3: unauth, score=1500, wouldBeRank=5000 → GOOD RUN! fallback', () => {
  const prompt = buildAgitationPrompt({
    rank: null,
    run: run({ score: 1500 }),
    previousBestScore: 0,
    isAuthenticated: false,
    wouldBeRank: 5000
  });
  assert.equal(prompt.title, 'GOOD RUN!');
  assert.equal(prompt.hook, "You're getting better");
  assert.equal(prompt.boost, 'Save your score & keep progress');
});

// ── Authenticated rules ──────────────────────────────────────────────────────

test('A: auth, isFirstRunAfterAuth=true → FIRST RUN!', () => {
  const prompt = buildAgitationPrompt({
    rank: 500,
    run: run({ score: 800 }),
    previousBestScore: 0,
    isAuthenticated: true,
    isFirstRunAfterAuth: true
  });
  assert.equal(prompt.title, 'FIRST RUN!');
  assert.equal(prompt.hook, 'Nice start');
  assert.equal(prompt.boost, "Let's see how far you can go");
});

test('B: auth, prevRank=2, score=400 → GOOD RUN! still TOP 3', () => {
  const prompt = buildAgitationPrompt({
    rank: 2,
    run: run({ score: 400 }),
    previousBestScore: 2000,
    isAuthenticated: true,
    prevRank: 2
  });
  assert.equal(prompt.title, 'GOOD RUN!');
  assert.equal(prompt.hook, "You're still TOP 3");
  assert.equal(prompt.boost, "Don't lose your position");
});

test('C: auth, prevRank=8, score=400 → GOOD RUN! still currentRank, push TOP 10', () => {
  const prompt = buildAgitationPrompt({
    rank: 8,
    run: run({ score: 400 }),
    previousBestScore: 2000,
    isAuthenticated: true,
    prevRank: 8
  });
  assert.equal(prompt.title, 'GOOD RUN!');
  assert.equal(prompt.hook, "You're still #8");
  assert.equal(prompt.boost, 'Push to stay in TOP 10');
});

test('D: auth, prevRank=200, score=400, prevBest=2000 → still rank, show best score', () => {
  const prompt = buildAgitationPrompt({
    rank: 200,
    run: run({ score: 400 }),
    previousBestScore: 2000,
    isAuthenticated: true,
    prevRank: 200
  });
  assert.equal(prompt.title, 'GOOD RUN!');
  assert.equal(prompt.hook, "You're still #200");
  assert.equal(prompt.boost, 'Your best score: 2000');
});

test('E: auth, score=400, prevRank=null → TRY AGAIN!', () => {
  const prompt = buildAgitationPrompt({
    rank: null,
    run: run({ score: 400 }),
    previousBestScore: 0,
    isAuthenticated: true,
    prevRank: null
  });
  assert.equal(prompt.title, 'TRY AGAIN!');
  assert.equal(prompt.hook, 'You can do better');
  assert.equal(prompt.boost, 'Go further this time');
});

test('F: auth, isPB, score=12000, prevRank=5, currentRank=1 → NEW LEADER!', () => {
  const prompt = buildAgitationPrompt({
    rank: 1,
    run: run({ score: 12000, isPersonalBest: true }),
    previousBestScore: 8000,
    isAuthenticated: true,
    prevRank: 5
  });
  assert.equal(prompt.title, 'NEW LEADER!');
  assert.equal(prompt.hook, 'No one is above you');
  assert.equal(prompt.boost, "Don't stop. Beat your record.");
});

test('G: auth, isPB, prevRank=10, currentRank=2 → TOP 3!', () => {
  const prompt = buildAgitationPrompt({
    rank: 2,
    run: run({ score: 5000, isPersonalBest: true }),
    previousBestScore: 3000,
    isAuthenticated: true,
    prevRank: 10
  });
  assert.equal(prompt.title, 'TOP 3!');
  assert.equal(prompt.hook, 'Amazing');
  assert.equal(prompt.boost, 'Push to reach #1');
});

test('H: auth, isPB, prevRank=15, currentRank=8, firstTimeMilestone=10 → TOP 10!', () => {
  const prompt = buildAgitationPrompt({
    rank: 8,
    run: run({ score: 4000, isPersonalBest: true }),
    previousBestScore: 2000,
    isAuthenticated: true,
    prevRank: 15,
    firstTimeMilestone: '10'
  });
  assert.equal(prompt.title, 'TOP 10!');
  assert.equal(prompt.hook, 'Now everyone can see you');
  assert.equal(prompt.boost, 'Almost TOP 3');
});

test('I: auth, isPB, prevRank=200, currentRank=80, firstTimeMilestone=100 → TOP 100!', () => {
  const prompt = buildAgitationPrompt({
    rank: 80,
    run: run({ score: 3000, isPersonalBest: true }),
    previousBestScore: 1000,
    isAuthenticated: true,
    prevRank: 200,
    firstTimeMilestone: '100'
  });
  assert.equal(prompt.title, 'TOP 100!');
  assert.equal(prompt.hook, 'Keep climbing');
  assert.equal(prompt.boost, 'Almost TOP 10');
});

test('J: auth, isPB, prevRank=2000, currentRank=800, firstTimeMilestone=1000 → TOP 1000!', () => {
  const prompt = buildAgitationPrompt({
    rank: 800,
    run: run({ score: 2000, isPersonalBest: true }),
    previousBestScore: 500,
    isAuthenticated: true,
    prevRank: 2000,
    firstTimeMilestone: '1000'
  });
  assert.equal(prompt.title, 'TOP 1000!');
  assert.equal(prompt.hook, "You're improving");
  assert.equal(prompt.boost, 'Next: TOP 100');
});

test('K: auth, isPB, prevRank=null, currentRank=8500, firstTimeMilestone=10000 → IN TOP 10000!', () => {
  const prompt = buildAgitationPrompt({
    rank: 8500,
    run: run({ score: 1200, isPersonalBest: true }),
    previousBestScore: 0,
    isAuthenticated: true,
    prevRank: null,
    firstTimeMilestone: '10000'
  });
  assert.equal(prompt.title, 'IN TOP 10000!');
  assert.equal(prompt.hook, 'Keep climbing');
  assert.equal(prompt.boost, 'Next: TOP 1000');
});

test('L: auth, isPB, prevRank=1, currentRank=1 → NEW RECORD!', () => {
  const prompt = buildAgitationPrompt({
    rank: 1,
    run: run({ score: 15000, isPersonalBest: true }),
    previousBestScore: 12000,
    isAuthenticated: true,
    prevRank: 1
  });
  assert.equal(prompt.title, 'NEW RECORD!');
  assert.equal(prompt.hook, 'There are only mountains above you');
  assert.equal(prompt.boost, "Don't stop. Beat your record.");
});

test('M: auth, isPB, prevRank=2, currentRank=2 → NEW PERSONAL RECORD!', () => {
  const prompt = buildAgitationPrompt({
    rank: 2,
    run: run({ score: 9000, isPersonalBest: true }),
    previousBestScore: 8000,
    isAuthenticated: true,
    prevRank: 2
  });
  assert.equal(prompt.title, 'NEW PERSONAL RECORD!');
  assert.equal(prompt.hook, 'Amazing');
  assert.equal(prompt.boost, 'Push to reach #1');
});

test('N: auth, isPB, score=5000, nextRankDelta=4, currentRank=42 → JUST A BIT MORE!', () => {
  const prompt = buildAgitationPrompt({
    rank: 42,
    run: run({ score: 5000, isPersonalBest: true }),
    previousBestScore: 4000,
    isAuthenticated: true,
    nextRankDelta: 4,
    prevRank: 50
  });
  assert.equal(prompt.title, 'JUST A BIT MORE!');
  assert.equal(prompt.hook, 'So close');
  assert.equal(prompt.boost, '+4 to reach #41');
});

test('O: auth, score=2000, not isPB, consecutiveStuckRuns=3 → NOT BAD!', () => {
  const prompt = buildAgitationPrompt({
    rank: 100,
    run: run({ score: 2000, isPersonalBest: false }),
    previousBestScore: 5000,
    isAuthenticated: true,
    consecutiveStuckRuns: 3,
    prevRank: null
  });
  assert.equal(prompt.title, 'NOT BAD!');
  assert.equal(prompt.hook, 'Need more power');
  assert.equal(prompt.boost, 'Upgrade to go further');
});

test('P: auth, score=2000, not isPB, prevBest=3500 → GOOD RUN! with delta boost', () => {
  const prompt = buildAgitationPrompt({
    rank: 200,
    run: run({ score: 2000, isPersonalBest: false }),
    previousBestScore: 3500,
    isAuthenticated: true,
    prevRank: null
  });
  assert.equal(prompt.title, 'GOOD RUN!');
  assert.equal(prompt.hook, 'Keep pushing');
  assert.equal(prompt.boost, '+1500 to your best');
});

test('Q: auth, isPB, firstTimeMilestone=null, no higher rule matches → PERSONAL BEST!', () => {
  const prompt = buildAgitationPrompt({
    rank: 500,
    run: run({ score: 3000, isPersonalBest: true }),
    previousBestScore: 2500,
    isAuthenticated: true,
    prevRank: 520,
    firstTimeMilestone: null,
    nextRankDelta: 50
  });
  assert.equal(prompt.title, 'PERSONAL BEST!');
  assert.equal(prompt.hook, "You're getting stronger");
  assert.equal(prompt.boost, 'Keep climbing');
});

// ── computeFirstTimeMilestone helper ─────────────────────────────────────────

test('computeFirstTimeMilestone returns smallest entered milestone', () => {
  assert.equal(computeFirstTimeMilestone(null, 1), '1');
  assert.equal(computeFirstTimeMilestone(5, 1), '1');
  assert.equal(computeFirstTimeMilestone(null, 2), '3');
  assert.equal(computeFirstTimeMilestone(2, 2), null);
  assert.equal(computeFirstTimeMilestone(null, 5), '10');
  assert.equal(computeFirstTimeMilestone(4, 2), '3');
  assert.equal(computeFirstTimeMilestone(15, 8), '10');
  assert.equal(computeFirstTimeMilestone(200, 80), '100');
  assert.equal(computeFirstTimeMilestone(2000, 800), '1000');
  assert.equal(computeFirstTimeMilestone(null, 8500), '10000');
  assert.equal(computeFirstTimeMilestone(8500, 8500), null);
});

// ── buildGameOverLeaderboardSlice (kept from original) ───────────────────────

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
