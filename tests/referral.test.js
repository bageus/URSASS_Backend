const test = require('node:test');
const assert = require('node:assert/strict');

const { generateReferralCode, buildReferralUrl } = require('../utils/referral');
const Player = require('../models/Player');
const AccountLink = require('../models/AccountLink');
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

// ── Tests ────────────────────────────────────────────────────────────────────

test('generateReferralCode produces 8-char code from correct alphabet', () => {
  const code = generateReferralCode();
  assert.equal(code.length, 8);
  // No ambiguous characters
  assert.ok(!/[01IiLlOo]/.test(code), `Code contains ambiguous chars: ${code}`);
  // Only allowed characters
  assert.ok(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(code), `Invalid code: ${code}`);
});

test('generateReferralCode generates unique codes', () => {
  const codes = new Set();
  for (let i = 0; i < 200; i++) {
    codes.add(generateReferralCode());
  }
  assert.ok(codes.size >= 190, `Too many collisions: ${codes.size} unique out of 200`);
});

test('buildReferralUrl uses FRONTEND_BASE_URL env', () => {
  const orig = process.env.FRONTEND_BASE_URL;
  process.env.FRONTEND_BASE_URL = 'https://ursasstube.fun';
  const url = buildReferralUrl('ABCD1234');
  assert.equal(url, 'https://ursasstube.fun/?ref=ABCD1234');
  process.env.FRONTEND_BASE_URL = orig || '';
});

test('POST /api/referral/track - requires auth', async () => {
  const { server, baseUrl } = await startServer();
  try {
    AccountLink.findOne = async () => null;
    const r = await post(baseUrl, '/api/referral/track', { ref: 'ABC12345' });
    assert.equal(r.status, 401);
  } finally {
    server.close();
  }
});

test('POST /api/referral/track - track ok', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = { primaryId: 'tg_111', telegramId: '111', wallet: null };
    AccountLink.findOne = async (q) => {
      if (q.primaryId === 'tg_111') return link;
      return null;
    };

    const currentPlayer = {
      wallet: 'tg_111',
      referralCode: 'MYCODE11',
      referredBy: null,
      save: async function() {}
    };
    const referrerPlayer = {
      wallet: '0xreferrer',
      referralCode: 'REFCODE1'
    };

    Player.findOne = async (q) => {
      if (q.wallet === 'tg_111') return currentPlayer;
      return null;
    };
    Player.findOneAndUpdate = async (q, update, opts) => {
      if (q.wallet === 'tg_111' && q.referredBy === null) {
        currentPlayer.referredBy = update.$set.referredBy;
        return { ...currentPlayer };
      }
      return null;
    };
    // Mock Player.findOne for referrer search
    const origFindOne = Player.findOne;
    Player.findOne = async (q) => {
      if (q.wallet === 'tg_111') return currentPlayer;
      if (q.referralCode === 'REFCODE1') return referrerPlayer;
      return null;
    };

    const r = await post(baseUrl, '/api/referral/track', { ref: 'REFCODE1' }, {
      'X-Primary-Id': 'tg_111'
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.success, true);
    assert.equal(currentPlayer.referredBy, 'REFCODE1');

    Player.findOne = origFindOne;
  } finally {
    server.close();
  }
});

test('POST /api/referral/track - self-referral blocked (400)', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = { primaryId: 'tg_222', telegramId: '222', wallet: null };
    AccountLink.findOne = async (q) => {
      if (q.primaryId === 'tg_222') return link;
      return null;
    };

    const currentPlayer = {
      wallet: 'tg_222',
      referralCode: 'SELFREF1',
      referredBy: null,
      save: async function() {}
    };
    Player.findOne = async () => currentPlayer;
    Player.findOneAndUpdate = async () => null;

    const r = await post(baseUrl, '/api/referral/track', { ref: 'SELFREF1' }, {
      'X-Primary-Id': 'tg_222'
    });
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes('own'));
  } finally {
    server.close();
  }
});

test('POST /api/referral/track - unknown ref returns 404', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = { primaryId: 'tg_333', telegramId: '333', wallet: null };
    AccountLink.findOne = async (q) => {
      if (q.primaryId === 'tg_333') return link;
      return null;
    };

    const currentPlayer = {
      wallet: 'tg_333',
      referralCode: 'MYCODE33',
      referredBy: null
    };
    Player.findOne = async (q) => {
      if (q.wallet === 'tg_333') return currentPlayer;
      if (q.referralCode) return null; // not found
      return null;
    };
    Player.findOneAndUpdate = async () => null;

    const r = await post(baseUrl, '/api/referral/track', { ref: 'UNKNOWN1' }, {
      'X-Primary-Id': 'tg_333'
    });
    assert.equal(r.status, 404);
  } finally {
    server.close();
  }
});

test('POST /api/referral/track - second time idempotent (returns already:true)', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const link = { primaryId: 'tg_444', telegramId: '444', wallet: null };
    AccountLink.findOne = async (q) => {
      if (q.primaryId === 'tg_444') return link;
      return null;
    };

    const currentPlayer = {
      wallet: 'tg_444',
      referralCode: 'MYCODE44',
      referredBy: 'ALREADY1' // already set
    };
    Player.findOne = async () => currentPlayer;

    const r = await post(baseUrl, '/api/referral/track', { ref: 'REFCODE2' }, {
      'X-Primary-Id': 'tg_444'
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.already, true);
  } finally {
    server.close();
  }
});
