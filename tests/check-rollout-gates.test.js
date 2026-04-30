const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const scriptPath = path.join(__dirname, '..', 'scripts', 'check-rollout-gates.js');

function runGate(env = {}) {
  return spawnSync(process.execPath, [scriptPath], {
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
}

test('rollout gates pass when no signals are provided', () => {
  const result = runGate({
    SIGNAL_5XX_RATE: '',
    SIGNAL_P95_LEADERBOARD_MS: '',
    SIGNAL_MONGO_READY_STATE: '',
    SIGNAL_DONATION_FAILED_DELTA: '',
    SIGNAL_WALLET_CONNECT_FAILED_DELTA: ''
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Rollout gate passed/i);
});

test('rollout gates fail on 5xx threshold breach', () => {
  const result = runGate({
    SIGNAL_5XX_RATE: '0.5',
    GATE_MAX_5XX_RATE: '0.02'
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /5xx rate/i);
});

test('rollout gates fail when mongo readyState is degraded', () => {
  const result = runGate({ SIGNAL_MONGO_READY_STATE: '2' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /mongo readyState/i);
});
