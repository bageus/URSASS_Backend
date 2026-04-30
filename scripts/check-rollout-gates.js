#!/usr/bin/env node

function readNumber(name, fallback = null) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const thresholds = {
  maxErrorRate5xx: readNumber('GATE_MAX_5XX_RATE', 0.02),
  maxP95LeaderboardMs: readNumber('GATE_MAX_P95_LEADERBOARD_MS', 800),
  maxDonationFailedDelta: readNumber('GATE_MAX_DONATION_FAILED_DELTA', 0.25),
  maxWalletConnectFailedDelta: readNumber('GATE_MAX_WALLET_CONNECT_FAILED_DELTA', 0.25)
};

const signals = {
  errorRate5xx: readNumber('SIGNAL_5XX_RATE'),
  p95LeaderboardMs: readNumber('SIGNAL_P95_LEADERBOARD_MS'),
  mongoReadyState: readNumber('SIGNAL_MONGO_READY_STATE'),
  donationFailedDelta: readNumber('SIGNAL_DONATION_FAILED_DELTA'),
  walletConnectFailedDelta: readNumber('SIGNAL_WALLET_CONNECT_FAILED_DELTA')
};

const failures = [];

if (signals.errorRate5xx !== null && signals.errorRate5xx > thresholds.maxErrorRate5xx) {
  failures.push(`5xx rate ${signals.errorRate5xx} > ${thresholds.maxErrorRate5xx}`);
}

if (signals.p95LeaderboardMs !== null && signals.p95LeaderboardMs > thresholds.maxP95LeaderboardMs) {
  failures.push(`p95 leaderboard ${signals.p95LeaderboardMs}ms > ${thresholds.maxP95LeaderboardMs}ms`);
}

if (signals.mongoReadyState !== null && signals.mongoReadyState !== 1) {
  failures.push(`mongo readyState ${signals.mongoReadyState} != 1`);
}

if (signals.donationFailedDelta !== null && signals.donationFailedDelta > thresholds.maxDonationFailedDelta) {
  failures.push(`donation_failed delta ${signals.donationFailedDelta} > ${thresholds.maxDonationFailedDelta}`);
}

if (signals.walletConnectFailedDelta !== null && signals.walletConnectFailedDelta > thresholds.maxWalletConnectFailedDelta) {
  failures.push(`wallet_connect_failed delta ${signals.walletConnectFailedDelta} > ${thresholds.maxWalletConnectFailedDelta}`);
}

if (failures.length > 0) {
  console.error('Rollout gate failed:');
  failures.forEach((f) => console.error(`- ${f}`));
  process.exit(1);
}

console.log('Rollout gate passed (or signals not provided).');
