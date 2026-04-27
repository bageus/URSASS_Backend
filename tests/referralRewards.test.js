const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../models/Player');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePlayer(overrides = {}) {
  return {
    _id: 'player_id_1',
    wallet: '0xplayer',
    referralCode: 'MYCODE11',
    referredBy: 'REFCODE1',
    referralRewardGranted: false,
    save: async function () {},
    ...overrides
  };
}

// Capture logger calls by overriding the logger module
let logCalls = [];

function resetLog() {
  logCalls = [];
}

// Intercept pino logger used in referralRewards
const logger = require('../utils/logger');
const origWarn = logger.warn.bind(logger);
const origInfo = logger.info.bind(logger);

// ── Tests ─────────────────────────────────────────────────────────────────────

test('maybeGrantReferralRewards: logs warn when player is missing', async () => {
  const { maybeGrantReferralRewards } = require('../utils/referralRewards');

  const warnings = [];
  logger.warn = (...args) => { warnings.push(args); };

  try {
    await maybeGrantReferralRewards(null);
    assert.ok(
      warnings.some(a => String(a[a.length - 1]).includes('player missing')),
      'Expected warn log for missing player'
    );
  } finally {
    logger.warn = origWarn;
  }
});

test('maybeGrantReferralRewards: logs info when already granted', async () => {
  const { maybeGrantReferralRewards } = require('../utils/referralRewards');

  const infos = [];
  logger.info = (...args) => { infos.push(args); };

  try {
    const player = makePlayer({ referralRewardGranted: true });
    await maybeGrantReferralRewards(player, { requestId: 'req-1' });
    assert.ok(
      infos.some(a => String(a[a.length - 1]).includes('already granted')),
      'Expected info log for already granted'
    );
  } finally {
    logger.info = origInfo;
  }
});

test('maybeGrantReferralRewards: logs info when no referredBy', async () => {
  const { maybeGrantReferralRewards } = require('../utils/referralRewards');

  const infos = [];
  logger.info = (...args) => { infos.push(args); };

  try {
    const player = makePlayer({ referredBy: null });
    await maybeGrantReferralRewards(player, { requestId: 'req-2' });
    assert.ok(
      infos.some(a => String(a[a.length - 1]).includes('was not referred')),
      'Expected info log for no referredBy'
    );
  } finally {
    logger.info = origInfo;
  }
});

test('maybeGrantReferralRewards: logs warn when referrer not found', async () => {
  const { maybeGrantReferralRewards } = require('../utils/referralRewards');

  Player.findOne = async () => null;

  const warnings = [];
  logger.warn = (...args) => { warnings.push(args); };

  try {
    const player = makePlayer();
    await maybeGrantReferralRewards(player, { requestId: 'req-3' });
    assert.ok(
      warnings.some(a => String(a[a.length - 1]).includes('referrer not found')),
      'Expected warn log for referrer not found'
    );
  } finally {
    logger.warn = origWarn;
  }
});

test('maybeGrantReferralRewards: does not throw when referralRewardGranted=true', async () => {
  const { maybeGrantReferralRewards } = require('../utils/referralRewards');

  const player = makePlayer({ referralRewardGranted: true });
  await assert.doesNotReject(() => maybeGrantReferralRewards(player));
});

test('maybeGrantReferralRewards: does not throw when referredBy=null', async () => {
  const { maybeGrantReferralRewards } = require('../utils/referralRewards');

  const player = makePlayer({ referredBy: null });
  await assert.doesNotReject(() => maybeGrantReferralRewards(player));
});
