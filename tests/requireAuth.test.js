/**
 * tests/requireAuth.test.js
 *
 * Unit tests for middleware/requireAuth.js (findLink + requireAuth).
 *
 * Coverage:
 *   - wallet-auth user: X-Wallet: 0xabc → found by wallet
 *   - telegram-auth user without linked wallet: X-Wallet: tg_123 → found by primaryId (fallback)
 *   - legacy wallet-only: X-Primary-Id: 0xabc → found by primaryId or wallet fallback
 *   - No match → 401
 *   - Telegram initData valid → found by telegramId
 *   - initData invalid → 401 with specific message
 *   - requireAuth sets req.primaryId and req.authLink
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const AccountLink = require('../models/AccountLink');
const { findLink, requireAuth } = require('../middleware/requireAuth');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeLink(overrides = {}) {
  return {
    primaryId: 'tg_test1',
    telegramId: '1001',
    wallet: '0xabc',
    telegramUsername: 'testuser',
    ...overrides
  };
}

/**
 * Build a minimal fake req/res/next triple for testing requireAuth directly.
 */
function makeReqRes(headers = {}) {
  const req = {
    _headers: headers,
    get(name) {
      const key = name.toLowerCase();
      for (const [k, v] of Object.entries(this._headers)) {
        if (k.toLowerCase() === key) return v;
      }
      return undefined;
    }
  };

  let statusCode = null;
  let jsonBody = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { jsonBody = body; return this; },
    getStatus() { return statusCode; },
    getJson() { return jsonBody; }
  };

  let nextCalled = false;
  let nextError = null;
  function next(err) {
    nextCalled = true;
    if (err) nextError = err;
  }

  return { req, res, next, isNextCalled: () => nextCalled, getNextError: () => nextError };
}

/**
 * Build a correctly signed Telegram initData string for a given userId and botToken.
 * This generates a real HMAC so validateTelegramInitData passes without mocking.
 */
function makeValidInitData(userId, botToken) {
  const authDate = Math.floor(Date.now() / 1000);
  const userJson = JSON.stringify({ id: userId, first_name: 'Test' });

  // Pairs used to build the data-check string (sorted, no hash)
  const pairs = [
    ['auth_date', String(authDate)],
    ['user', userJson]
  ].sort(([a], [b]) => a.localeCompare(b));

  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const params = new URLSearchParams(pairs);
  params.set('hash', hash);
  return params.toString();
}

// ── findLink unit tests ───────────────────────────────────────────────────────

test('findLink: wallet-auth user — X-Wallet 0xabc → found by wallet field', async () => {
  const link = makeLink({ primaryId: 'tg_abc', wallet: '0xabc' });
  const origFindOne = AccountLink.findOne;
  try {
    AccountLink.findOne = async (q) => {
      if (q.wallet === '0xabc') return link;
      return null;
    };
    const result = await findLink('', '0xabc', '', '');
    assert.ok(result, 'should find a link');
    assert.equal(result.wallet, '0xabc');
    assert.equal(result.primaryId, 'tg_abc');
  } finally {
    AccountLink.findOne = origFindOne;
  }
});

test('findLink: telegram-auth user without wallet — X-Wallet: tg_123 → fallback to primaryId', async () => {
  const link = makeLink({ primaryId: 'tg_123', wallet: null });
  const origFindOne = AccountLink.findOne;
  try {
    AccountLink.findOne = async (q) => {
      if (q.wallet === 'tg_123') return null;   // not found by wallet
      if (q.primaryId === 'tg_123') return link; // found by primaryId (fallback)
      return null;
    };
    const result = await findLink('', 'tg_123', '', '');
    assert.ok(result, 'should find a link via primaryId fallback');
    assert.equal(result.primaryId, 'tg_123');
  } finally {
    AccountLink.findOne = origFindOne;
  }
});

test('findLink: legacy wallet-only — X-Primary-Id: 0xabc → found by primaryId', async () => {
  const link = makeLink({ primaryId: '0xabc', wallet: '0xabc' });
  const origFindOne = AccountLink.findOne;
  try {
    AccountLink.findOne = async (q) => {
      if (q.primaryId === '0xabc') return link;
      return null;
    };
    const result = await findLink('0xabc', '', '', '');
    assert.ok(result, 'should find a link by primaryId');
    assert.equal(result.primaryId, '0xabc');
  } finally {
    AccountLink.findOne = origFindOne;
  }
});

test('findLink: X-Primary-Id set but not in primaryId field → fallback to wallet', async () => {
  const link = makeLink({ primaryId: 'tg_fallback', wallet: '0xfallback' });
  const origFindOne = AccountLink.findOne;
  try {
    AccountLink.findOne = async (q) => {
      if (q.primaryId === '0xfallback') return null; // not by primaryId
      if (q.wallet === '0xfallback') return link;    // found by wallet fallback
      return null;
    };
    const result = await findLink('0xfallback', '', '', '');
    assert.ok(result, 'should find a link via wallet fallback');
    assert.equal(result.primaryId, 'tg_fallback');
  } finally {
    AccountLink.findOne = origFindOne;
  }
});

test('findLink: no match → returns null', async () => {
  const origFindOne = AccountLink.findOne;
  try {
    AccountLink.findOne = async () => null;
    const result = await findLink('nobody', 'nobody', '', '');
    assert.equal(result, null);
  } finally {
    AccountLink.findOne = origFindOne;
  }
});

test('findLink: no identifiers provided → returns null', async () => {
  const origFindOne = AccountLink.findOne;
  try {
    AccountLink.findOne = async () => null;
    const result = await findLink('', '', '', '');
    assert.equal(result, null);
  } finally {
    AccountLink.findOne = origFindOne;
  }
});

test('findLink: valid Telegram initData → found by telegramId', async () => {
  const botToken = 'test_bot_token_12345';
  const userId = 987;
  const link = makeLink({ primaryId: 'tg_987', telegramId: String(userId) });

  const origFindOne = AccountLink.findOne;
  const origBotToken = process.env.TELEGRAM_BOT_TOKEN;
  try {
    process.env.TELEGRAM_BOT_TOKEN = botToken;
    AccountLink.findOne = async (q) => {
      if (q.telegramId === String(userId)) return link;
      return null;
    };
    const initData = makeValidInitData(userId, botToken);
    const result = await findLink('', '', '', initData);
    assert.ok(result, 'should find a link by telegramId');
    assert.equal(result.telegramId, String(userId));
  } finally {
    process.env.TELEGRAM_BOT_TOKEN = origBotToken;
    AccountLink.findOne = origFindOne;
  }
});

test('findLink: Authorization bearer value mapped to primaryId works', async () => {
  const link = makeLink({ primaryId: 'tg_bearer', wallet: null });
  const origFindOne = AccountLink.findOne;
  try {
    AccountLink.findOne = async (q) => {
      if (q.primaryId === 'tg_bearer') return link;
      return null;
    };
    const result = await findLink('', '', 'tg_bearer', '');
    assert.ok(result, 'should find a link using bearer id as primaryId');
    assert.equal(result.primaryId, 'tg_bearer');
  } finally {
    AccountLink.findOne = origFindOne;
  }
});

test('findLink: invalid Telegram initData → returns { __invalid: "initdata" }', async () => {
  const origFindOne = AccountLink.findOne;
  try {
    AccountLink.findOne = async () => null;
    // 'bad_init_data' has no hash field → will fail validation
    const result = await findLink('', '', '', 'bad_init_data');
    assert.ok(result, 'should return sentinel object');
    assert.equal(result.__invalid, 'initdata');
  } finally {
    AccountLink.findOne = origFindOne;
  }
});

// ── requireAuth middleware tests ──────────────────────────────────────────────

test('requireAuth: sets req.primaryId and req.authLink on success', async () => {
  const link = makeLink({ primaryId: 'tg_mw1', wallet: '0xmw1' });
  const origFindOne = AccountLink.findOne;
  try {
    AccountLink.findOne = async (q) => {
      if (q.primaryId === 'tg_mw1') return link;
      return null;
    };
    const { req, res, next, isNextCalled } = makeReqRes({ 'x-primary-id': 'tg_mw1' });
    await requireAuth(req, res, next);
    assert.ok(isNextCalled(), 'next() should be called');
    assert.equal(req.primaryId, 'tg_mw1');
    assert.deepStrictEqual(req.authLink, link);
  } finally {
    AccountLink.findOne = origFindOne;
  }
});

test('requireAuth: Authorization Bearer header authenticates user', async () => {
  const link = makeLink({ primaryId: 'tg_token', wallet: '0xtoken' });
  const origFindOne = AccountLink.findOne;
  try {
    AccountLink.findOne = async (q) => {
      if (q.primaryId === 'tg_token') return link;
      return null;
    };
    const { req, res, next, isNextCalled } = makeReqRes({ authorization: 'Bearer tg_token' });
    await requireAuth(req, res, next);
    assert.ok(isNextCalled(), 'next() should be called');
    assert.equal(req.primaryId, 'tg_token');
    assert.deepStrictEqual(req.authLink, link);
  } finally {
    AccountLink.findOne = origFindOne;
  }
});

test('requireAuth: no link found → 401 JSON', async () => {
  const origFindOne = AccountLink.findOne;
  try {
    AccountLink.findOne = async () => null;
    const { req, res, next, isNextCalled } = makeReqRes({ 'x-primary-id': 'unknown' });
    await requireAuth(req, res, next);
    assert.ok(!isNextCalled(), 'next() should NOT be called');
    assert.equal(res.getStatus(), 401);
    assert.ok(res.getJson()?.error, 'should return error JSON');
  } finally {
    AccountLink.findOne = origFindOne;
  }
});

test('requireAuth: no headers at all → 401 JSON', async () => {
  const origFindOne = AccountLink.findOne;
  try {
    AccountLink.findOne = async () => null;
    const { req, res, next, isNextCalled } = makeReqRes({});
    await requireAuth(req, res, next);
    assert.ok(!isNextCalled(), 'next() should NOT be called');
    assert.equal(res.getStatus(), 401);
  } finally {
    AccountLink.findOne = origFindOne;
  }
});

test('requireAuth: invalid initData → 401 with "Invalid Telegram auth"', async () => {
  const origFindOne = AccountLink.findOne;
  try {
    AccountLink.findOne = async () => null;
    // 'bad_data' will fail HMAC check in validateTelegramInitData
    const { req, res, next, isNextCalled } = makeReqRes({ 'x-telegram-init-data': 'bad_data' });
    await requireAuth(req, res, next);
    assert.ok(!isNextCalled(), 'next() should NOT be called');
    assert.equal(res.getStatus(), 401);
    assert.equal(res.getJson()?.error, 'Invalid Telegram auth');
  } finally {
    AccountLink.findOne = origFindOne;
  }
});
