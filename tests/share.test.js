const test = require('node:test');
const assert = require('node:assert/strict');

const { getUtcDayKey, getYesterdayUtcDayKey } = require('../utils/utcDay');

// ── utcDay helpers ────────────────────────────────────────────────────────────

test('getUtcDayKey returns YYYY-MM-DD format', () => {
  const key = getUtcDayKey(new Date('2026-04-26T12:00:00Z'));
  assert.equal(key, '2026-04-26');
});

test('getUtcDayKey handles midnight boundaries correctly', () => {
  assert.equal(getUtcDayKey(new Date('2026-01-01T00:00:00Z')), '2026-01-01');
  assert.equal(getUtcDayKey(new Date('2026-12-31T23:59:59Z')), '2026-12-31');
});

test('getYesterdayUtcDayKey returns a date before today', () => {
  const today = getUtcDayKey();
  const yesterday = getYesterdayUtcDayKey();
  assert.ok(yesterday < today, `yesterday (${yesterday}) should be < today (${today})`);
});

// ── Share flow logic (simulated, no DB) ──────────────────────────────────────

const SHARE_REWARD_DELAY_MS = 30000;

function simulateConfirm({ startedAt, elapsed, alreadyConfirmed = false, alreadyRewardedToday = false }) {
  if (alreadyConfirmed) {
    return { result: 'idempotent' };
  }

  const now = startedAt + elapsed;
  if (elapsed < SHARE_REWARD_DELAY_MS) {
    return { result: 'too_early', secondsLeft: Math.ceil((SHARE_REWARD_DELAY_MS - elapsed) / 1000) };
  }

  if (alreadyRewardedToday) {
    return { result: 'already_rewarded_today' };
  }

  return { result: 'awarded', goldAwarded: 20 };
}

test('share confirm: too early if < 30 seconds elapsed', () => {
  const startedAt = Date.now();
  const res = simulateConfirm({ startedAt, elapsed: 15000 });
  assert.equal(res.result, 'too_early');
  assert.equal(res.secondsLeft, 15);
});

test('share confirm: exactly at 30s boundary succeeds', () => {
  const startedAt = Date.now();
  const res = simulateConfirm({ startedAt, elapsed: 30000 });
  assert.equal(res.result, 'awarded');
  assert.equal(res.goldAwarded, 20);
});

test('share confirm: > 30 seconds succeeds and awards 20 gold', () => {
  const startedAt = Date.now();
  const res = simulateConfirm({ startedAt, elapsed: 60000 });
  assert.equal(res.result, 'awarded');
  assert.equal(res.goldAwarded, 20);
});

test('share confirm: repeat in same day does not re-award', () => {
  const startedAt = Date.now();
  const res = simulateConfirm({ startedAt, elapsed: 60000, alreadyRewardedToday: true });
  assert.equal(res.result, 'already_rewarded_today');
});

test('share confirm: already confirmed returns idempotent result', () => {
  const startedAt = Date.now();
  const res = simulateConfirm({ startedAt, elapsed: 60000, alreadyConfirmed: true });
  assert.equal(res.result, 'idempotent');
});

// ── Share streak logic ────────────────────────────────────────────────────────

function computeNewStreak(lastShareDay, currentShareStreak, today, yesterday) {
  if (lastShareDay === yesterday) {
    return currentShareStreak + 1;
  }
  return 1;
}

function computeDisplayStreak(lastShareDay, shareStreak, today, yesterday) {
  if (lastShareDay && lastShareDay < yesterday) {
    return 0;
  }
  return shareStreak;
}

test('streak: increments by 1 when lastShareDay is yesterday', () => {
  const today = '2026-04-26';
  const yesterday = '2026-04-25';
  const streak = computeNewStreak('2026-04-25', 3, today, yesterday);
  assert.equal(streak, 4);
});

test('streak: resets to 1 when lastShareDay is not yesterday', () => {
  const today = '2026-04-26';
  const yesterday = '2026-04-25';
  const streak = computeNewStreak('2026-04-20', 7, today, yesterday);
  assert.equal(streak, 1);
});

test('streak: resets to 1 on first share ever', () => {
  const today = '2026-04-26';
  const yesterday = '2026-04-25';
  const streak = computeNewStreak(null, 0, today, yesterday);
  assert.equal(streak, 1);
});

test('display streak: returns 0 if lastShareDay is older than yesterday', () => {
  const today = '2026-04-26';
  const yesterday = '2026-04-25';
  const display = computeDisplayStreak('2026-04-20', 5, today, yesterday);
  assert.equal(display, 0);
});

test('display streak: returns actual streak if lastShareDay is yesterday', () => {
  const today = '2026-04-26';
  const yesterday = '2026-04-25';
  const display = computeDisplayStreak('2026-04-25', 4, today, yesterday);
  assert.equal(display, 4);
});

test('display streak: returns actual streak if lastShareDay is today', () => {
  const today = '2026-04-26';
  const yesterday = '2026-04-25';
  const display = computeDisplayStreak('2026-04-26', 2, today, yesterday);
  assert.equal(display, 2);
});
