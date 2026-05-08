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


async function get(baseUrl, path, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
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
  assert.equal(url, 'https://ursasstube.fun/?ref_hint=ABCD1234');
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
    Player.findOneAndUpdate = async (q, update) => {
      const p = players[q.wallet];
      if (!p) return null;
      p.gold = (p.gold || 0) + (update.$inc?.gold || 0);
      return p;
    };

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
    Player.findOneAndUpdate = async (q, update) => { const p = players[q.wallet]; if (!p) return null; p.gold = (p.gold || 0) + (update.$inc?.gold || 0); return p; };

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

const ReferralReward = require('../models/ReferralReward');
const CoinTransaction = require('../models/CoinTransaction');

test('POST /api/referral/apply - awards both users and writes history', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const players = {
      tg_apply1: { wallet: 'tg_apply1', referralCode: 'ME111111', gold: 0 },
      tg_referrer: { wallet: 'tg_referrer', referralCode: 'REF11111', gold: 0 }
    };
    const rewards = [];
    const history = [];

    AccountLink.findOne = async (q) => (q.primaryId === 'tg_apply1' ? { primaryId: 'tg_apply1' } : null);
    Player.findOne = async (q) => q.wallet ? players[q.wallet] || null : Object.values(players).find(p => p.referralCode === q.referralCode) || null;
    Player.findOneAndUpdate = async (q, update) => {
      const p = players[q.wallet];
      if (!p) return null;
      p.gold = (p.gold || 0) + (update.$inc?.gold || 0);
      return p;
    };
    Player.updateOne = async (q, update) => { if (players[q.wallet]) players[q.wallet].referredBy = update.$set.referredBy; return { acknowledged: true }; };
    ReferralReward.findOne = async (q) => rewards.find(r => r.referredPrimaryId === q.referredPrimaryId) || null;
    ReferralReward.create = async (doc) => { const r = { _id: 'rw1', ...doc, save: async function(){} }; rewards.push(r); return r; };
    CoinTransaction.findOne = async (q) => history.find(h => h.contextKey === q.contextKey) || null;
    CoinTransaction.create = async (doc) => { history.push(doc); return doc; };

    Player.countDocuments = async () => 0;

    const r = await post(baseUrl, '/api/referral/apply', { referralCode: 'REF11111' }, { 'X-Primary-Id': 'tg_apply1' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(players.tg_apply1.gold, 100);
    assert.equal(players.tg_referrer.gold, 50);
    assert.equal(history.length, 2);
    assert.ok(history.some((entry) => entry.type === 'referral' && entry.primaryId === 'tg_apply1' && entry.gold === 100));

    const profile = await get(baseUrl, '/api/account/me/profile', { 'X-Primary-Id': 'tg_apply1' });
    assert.equal(profile.status, 200, JSON.stringify(profile.body));
    assert.equal(profile.body.rewardGold, 100);
    assert.equal(profile.body.totalGoldCoins, 0);
    assert.equal(profile.body.gold, 100);
  } finally { server.close(); }
});

test('POST /api/referral/apply - retry after partial reward repairs without double-award', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const players = {
      tg_apply2: { wallet: 'tg_apply2', referralCode: 'ME222222', gold: 0 },
      tg_referrer2: { wallet: 'tg_referrer2', referralCode: 'REF22222', gold: 0 }
    };
    const reward = { _id: 'rw2', referredPrimaryId: 'tg_apply2', referrerPrimaryId: 'tg_referrer2', referralCode: 'REF22222', referredBalanceCreditedAt: null, referrerBalanceCreditedAt: null, referredHistoryRecordedAt: null, referrerHistoryRecordedAt: null, save: async function(){} };
    const history = [];

    AccountLink.findOne = async (q) => (q.primaryId === 'tg_apply2' ? { primaryId: 'tg_apply2' } : null);
    Player.findOne = async (q) => q.wallet ? players[q.wallet] || null : Object.values(players).find(p => p.referralCode === q.referralCode) || null;
    Player.findOneAndUpdate = async (q, update) => {
      const p = players[q.wallet];
      if (!p) return null;
      p.gold = (p.gold || 0) + (update.$inc?.gold || 0);
      return p;
    };
    Player.updateOne = async () => ({ acknowledged: true });
    ReferralReward.findOne = async () => reward;
    ReferralReward.create = async () => { throw new Error('should not create'); };
    CoinTransaction.findOne = async (q) => history.find(h => h.contextKey === q.contextKey) || null;
    CoinTransaction.create = async (doc) => { history.push(doc); return doc; };

    const r1 = await post(baseUrl, '/api/referral/apply', { referralCode: 'REF22222' }, { 'X-Primary-Id': 'tg_apply2' });
    const r2 = await post(baseUrl, '/api/referral/apply', { referralCode: 'REF22222' }, { 'X-Primary-Id': 'tg_apply2' });
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.equal(players.tg_apply2.gold, 100);
    assert.equal(players.tg_referrer2.gold, 50);
    assert.equal(history.length, 2);
  } finally { server.close(); }
});
