/**
 * tests/xOAuth.test.js
 *
 * Tests for X (Twitter) OAuth 2.0 flow:
 *   - generatePkcePair / buildAuthorizeUrl utilities
 *   - GET /api/x/oauth/start
 *   - GET /api/x/oauth/callback
 *   - POST /api/x/disconnect
 *   - GET /api/x/status
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// Tested utilities (import before setting env so we can configure per-test)
const { generatePkcePair, buildAuthorizeUrl, isXOAuthConfigured } = require('../utils/xOAuth');
const xOAuthModule = require('../utils/xOAuth');

const AccountLink = require('../models/AccountLink');
const Player = require('../models/Player');
const OAuthState = require('../models/OAuthState');
const SecurityEvent = require('../models/SecurityEvent');
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
  const res = await fetch(`${baseUrl}${path}`, { headers, redirect: 'manual' });
  const contentType = res.headers.get('content-type') || '';
  let body = {};
  if (contentType.includes('application/json')) {
    body = await res.json().catch(() => ({}));
  }
  return { status: res.status, body, location: res.headers.get('location') };
}

async function post(baseUrl, path, body = {}, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

/**
 * Create a chainable Mongoose-like query mock.
 * Supports: await query, .select(...), .lean()
 */
function chainableQuery(doc) {
  const query = {
    _doc: doc,
    select() { return this; },
    lean() { return Promise.resolve(this._doc); },
    then(onFulfilled, onRejected) {
      return Promise.resolve(this._doc).then(onFulfilled, onRejected);
    },
    catch(onRejected) {
      return Promise.resolve(this._doc).catch(onRejected);
    }
  };
  return query;
}

function makePlayer(overrides = {}) {
  return {
    wallet: 'tg_xtest1',
    xUserId: null,
    xUsername: null,
    xAccessToken: null,
    xRefreshToken: null,
    xConnectedAt: null,
    referralCode: 'XTEST001',
    bestScore: 100,
    gold: 0,
    shareStreak: 0,
    lastShareDay: null,
    lastShareAt: null,
    save: async function() { return this; },
    ...overrides
  };
}

function setXOAuthEnv() {
  process.env.X_OAUTH_CLIENT_ID = 'test_client_id';
  process.env.X_OAUTH_CLIENT_SECRET = 'test_client_secret';
  process.env.X_OAUTH_REDIRECT_URI = 'https://api.ursasstube.fun/api/x/oauth/callback';
  process.env.X_OAUTH_SCOPES = 'tweet.read users.read offline.access';
  process.env.FRONTEND_BASE_URL = 'https://ursasstube.fun';
}

function clearXOAuthEnv() {
  delete process.env.X_OAUTH_CLIENT_ID;
  delete process.env.X_OAUTH_CLIENT_SECRET;
  delete process.env.X_OAUTH_REDIRECT_URI;
  delete process.env.X_OAUTH_SCOPES;
  delete process.env.FRONTEND_BASE_URL;
}

// ── Utility unit tests ────────────────────────────────────────────────────────

test('generatePkcePair returns valid base64url strings', () => {
  const { codeVerifier, codeChallenge } = generatePkcePair();

  // Both must be non-empty strings
  assert.ok(codeVerifier.length > 0, 'codeVerifier must not be empty');
  assert.ok(codeChallenge.length > 0, 'codeChallenge must not be empty');

  // base64url charset: A-Z a-z 0-9 - _  (no padding =)
  assert.ok(/^[A-Za-z0-9\-_]+$/.test(codeVerifier), 'codeVerifier must be base64url');
  assert.ok(/^[A-Za-z0-9\-_]+$/.test(codeChallenge), 'codeChallenge must be base64url');

  // Verify S256: SHA-256(verifier) === challenge
  const expected = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  assert.equal(codeChallenge, expected, 'codeChallenge must be SHA-256(codeVerifier) in base64url');
});

test('generatePkcePair produces distinct pairs on repeated calls', () => {
  const pairs = new Set();
  for (let i = 0; i < 50; i++) {
    const { codeVerifier } = generatePkcePair();
    pairs.add(codeVerifier);
  }
  assert.ok(pairs.size >= 48, `Expected ≥48 unique verifiers, got ${pairs.size}`);
});

test('buildAuthorizeUrl contains all required query parameters', () => {
  setXOAuthEnv();
  try {
    const { codeChallenge } = generatePkcePair();
    const state = crypto.randomBytes(16).toString('hex');
    const url = buildAuthorizeUrl({ state, codeChallenge });

    const parsed = new URL(url);
    assert.equal(parsed.hostname, 'x.com');
    assert.equal(parsed.searchParams.get('response_type'), 'code');
    assert.equal(parsed.searchParams.get('client_id'), 'test_client_id');
    assert.equal(parsed.searchParams.get('redirect_uri'), process.env.X_OAUTH_REDIRECT_URI);
    assert.ok(parsed.searchParams.get('scope'), 'scope must be present');
    assert.equal(parsed.searchParams.get('state'), state);
    assert.equal(parsed.searchParams.get('code_challenge'), codeChallenge);
    assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
  } finally {
    clearXOAuthEnv();
  }
});

// ── HTTP endpoint tests ───────────────────────────────────────────────────────

test('GET /api/x/oauth/start - 503 when X OAuth not configured', async () => {
  clearXOAuthEnv();
  const { server, baseUrl } = await startServer();
  try {
    const link = { primaryId: 'tg_x1', telegramId: '1', wallet: null };
    AccountLink.findOne = async () => link;
    Player.findOne = async () => makePlayer({ wallet: 'tg_x1' });

    const r = await get(baseUrl, '/api/x/oauth/start', { 'X-Primary-Id': 'tg_x1' });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'x_oauth_not_configured');
  } finally {
    server.close();
  }
});

test('GET /api/x/oauth/start - 401 when not authenticated', async () => {
  setXOAuthEnv();
  const { server, baseUrl } = await startServer();
  try {
    AccountLink.findOne = async () => null;
    const r = await get(baseUrl, '/api/x/oauth/start');
    assert.equal(r.status, 401);
  } finally {
    clearXOAuthEnv();
    server.close();
  }
});

test('GET /api/x/oauth/start - creates OAuthState and redirects (302)', async () => {
  setXOAuthEnv();
  const { server, baseUrl } = await startServer();
  try {
    const link = { primaryId: 'tg_x2', telegramId: '2', wallet: null };
    AccountLink.findOne = async () => link;
    Player.findOne = async () => makePlayer({ wallet: 'tg_x2' });

    const created = [];
    OAuthState.create = async (doc) => {
      created.push(doc);
      return { ...doc };
    };

    const r = await get(baseUrl, '/api/x/oauth/start', { 'X-Primary-Id': 'tg_x2' });
    assert.equal(r.status, 302, 'should redirect');
    assert.ok(r.location?.startsWith('https://x.com/i/oauth2/authorize'), `location should be X authorize URL, got: ${r.location}`);
    assert.equal(created.length, 1, 'OAuthState should be created');
    assert.equal(created[0].primaryId, 'tg_x2');
    assert.ok(created[0].codeVerifier, 'codeVerifier should be set');
    assert.ok(created[0].state, 'state should be set');
  } finally {
    clearXOAuthEnv();
    server.close();
  }
});

test('GET /api/x/oauth/start - ?mode=json returns JSON authorizeUrl', async () => {
  setXOAuthEnv();
  const { server, baseUrl } = await startServer();
  try {
    const link = { primaryId: 'tg_x3', telegramId: '3', wallet: null };
    AccountLink.findOne = async () => link;
    Player.findOne = async () => makePlayer({ wallet: 'tg_x3' });
    OAuthState.create = async (doc) => ({ ...doc });

    const r = await get(baseUrl, '/api/x/oauth/start?mode=json', { 'X-Primary-Id': 'tg_x3' });
    assert.equal(r.status, 200);
    assert.ok(r.body.authorizeUrl?.startsWith('https://x.com/i/oauth2/authorize'), 'should contain authorizeUrl');
  } finally {
    clearXOAuthEnv();
    server.close();
  }
});

test('GET /api/x/oauth/callback - invalid state redirects to error', async () => {
  setXOAuthEnv();
  const { server, baseUrl } = await startServer();
  try {
    OAuthState.findOne = async () => null; // state not found
    SecurityEvent.create = async () => ({}); // prevent DB timeout

    const r = await get(baseUrl, '/api/x/oauth/callback?code=abc&state=invalid_state_value');
    assert.equal(r.status, 302, 'should redirect');
    assert.ok(r.location?.includes('x=error'), `location should contain x=error, got: ${r.location}`);
    assert.ok(r.location?.includes('invalid_state'), `reason should be invalid_state, got: ${r.location}`);
  } finally {
    clearXOAuthEnv();
    server.close();
  }
});

test('GET /api/x/oauth/callback - X error param redirects to error', async () => {
  setXOAuthEnv();
  const { server, baseUrl } = await startServer();
  try {
    const r = await get(baseUrl, '/api/x/oauth/callback?error=access_denied');
    assert.equal(r.status, 302);
    assert.ok(r.location?.includes('x=error'), `got: ${r.location}`);
    assert.ok(r.location?.includes('access_denied'), `got: ${r.location}`);
  } finally {
    clearXOAuthEnv();
    server.close();
  }
});

test('GET /api/x/oauth/callback - missing params redirects to error', async () => {
  setXOAuthEnv();
  const { server, baseUrl } = await startServer();
  try {
    const r = await get(baseUrl, '/api/x/oauth/callback');
    assert.equal(r.status, 302);
    assert.ok(r.location?.includes('x=error'), `got: ${r.location}`);
    assert.ok(r.location?.includes('missing_params'), `got: ${r.location}`);
  } finally {
    clearXOAuthEnv();
    server.close();
  }
});

test('GET /api/x/oauth/callback - valid state, mocked X response → updates Player', async () => {
  setXOAuthEnv();
  const { server, baseUrl } = await startServer();

  // Patch module-level functions so routes/x.js (which uses xOAuth.fn()) picks them up
  const origExchange = xOAuthModule.exchangeCodeForToken;
  const origFetch = xOAuthModule.fetchXUser;

  try {
    // State must be a 64-char hex string (32 random bytes as hex)
    const validState = 'a'.repeat(64);
    const savedState = {
      state: validState,
      primaryId: 'tg_x4',
      codeVerifier: 'verifier_abc'
    };

    OAuthState.findOne = async (q) => (q.state === validState ? { ...savedState } : null);
    OAuthState.deleteOne = async () => {};
    SecurityEvent.create = async () => ({});

    const link = { primaryId: 'tg_x4', telegramId: '4', wallet: null };
    AccountLink.findOne = async () => link;

    const player = makePlayer({ wallet: 'tg_x4' });
    Player.findOne = (q) => {
      // duplicate-check query (has xUserId key)
      if ('xUserId' in q) return chainableQuery(null);
      // load-player query
      if (q.wallet === 'tg_x4') {
        const doc = { ...player, save: player.save };
        return chainableQuery(doc);
      }
      return chainableQuery(null);
    };

    // Patch xOAuth module so the route picks up the mock
    xOAuthModule.exchangeCodeForToken = async () => ({
      access_token: 'mock_access_token',
      refresh_token: 'mock_refresh_token',
      expires_in: 7200,
      scope: 'tweet.read users.read offline.access',
      token_type: 'bearer'
    });
    xOAuthModule.fetchXUser = async () => ({ id: 'x_user_999', username: 'mock_xuser' });

    const r = await get(
      baseUrl,
      `/api/x/oauth/callback?code=authcode&state=${validState}`
    );

    assert.equal(r.status, 302, `expected 302, got ${r.status}`);
    assert.ok(r.location?.includes('x=connected'), `location: ${r.location}`);
    assert.ok(r.location?.includes('mock_xuser'), `username in location: ${r.location}`);
  } finally {
    xOAuthModule.exchangeCodeForToken = origExchange;
    xOAuthModule.fetchXUser = origFetch;
    clearXOAuthEnv();
    server.close();
  }
});

test('POST /api/x/disconnect - 503 when X OAuth not configured', async () => {
  clearXOAuthEnv();
  const { server, baseUrl } = await startServer();
  try {
    AccountLink.findOne = async () => ({ primaryId: 'tg_x5', telegramId: '5', wallet: null });
    const r = await post(baseUrl, '/api/x/disconnect', {}, { 'X-Primary-Id': 'tg_x5' });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'x_oauth_not_configured');
  } finally {
    server.close();
  }
});

test('POST /api/x/disconnect - 401 without auth', async () => {
  setXOAuthEnv();
  const { server, baseUrl } = await startServer();
  try {
    AccountLink.findOne = async () => null;
    const r = await post(baseUrl, '/api/x/disconnect', {});
    assert.equal(r.status, 401);
  } finally {
    clearXOAuthEnv();
    server.close();
  }
});

test('POST /api/x/disconnect - clears X fields', async () => {
  setXOAuthEnv();
  const { server, baseUrl } = await startServer();

  const origRevoke = xOAuthModule.revokeToken;

  try {
    const link = { primaryId: 'tg_x6', telegramId: '6', wallet: null };
    AccountLink.findOne = async () => link;

    const player = makePlayer({
      wallet: 'tg_x6',
      xUserId: 'old_x_id',
      xUsername: 'old_xuser',
      xAccessToken: 'old_access',
      xRefreshToken: 'old_refresh',
      xConnectedAt: new Date()
    });

    // Return a chainable object that mimics Mongoose's select()
    Player.findOne = (q) => {
      const doc = { ...player, save: async function() { Object.assign(player, this); return this; } };
      return chainableQuery(doc);
    };

    let revokeCalledWith = null;
    xOAuthModule.revokeToken = async (token) => { revokeCalledWith = token; };

    const r = await post(baseUrl, '/api/x/disconnect', {}, { 'X-Primary-Id': 'tg_x6' });
    assert.equal(r.status, 200);
    assert.equal(r.body.disconnected, true);
    assert.equal(revokeCalledWith, 'old_refresh', 'should revoke refresh token');
  } finally {
    xOAuthModule.revokeToken = origRevoke;
    clearXOAuthEnv();
    server.close();
  }
});

test('GET /api/x/status - 503 when X OAuth not configured', async () => {
  clearXOAuthEnv();
  const { server, baseUrl } = await startServer();
  try {
    AccountLink.findOne = async () => ({ primaryId: 'tg_x7', telegramId: '7', wallet: null });
    const r = await get(baseUrl, '/api/x/status', { 'X-Primary-Id': 'tg_x7' });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'x_oauth_not_configured');
  } finally {
    server.close();
  }
});

test('GET /api/x/status - returns not connected when xUserId is null', async () => {
  setXOAuthEnv();
  const { server, baseUrl } = await startServer();
  try {
    const link = { primaryId: 'tg_x8', telegramId: '8', wallet: null };
    AccountLink.findOne = async () => link;

    // Return a chainable mock supporting .select().lean()
    Player.findOne = () => chainableQuery(makePlayer({ wallet: 'tg_x8', xUserId: null }));

    const r = await get(baseUrl, '/api/x/status', { 'X-Primary-Id': 'tg_x8' });
    assert.equal(r.status, 200);
    assert.equal(r.body.connected, false);
    assert.equal(r.body.username, null);
    assert.equal(r.body.connectedAt, null);
  } finally {
    clearXOAuthEnv();
    server.close();
  }
});

test('GET /api/x/status - returns connected with username after linking', async () => {
  setXOAuthEnv();
  const { server, baseUrl } = await startServer();
  try {
    const link = { primaryId: 'tg_x9', telegramId: '9', wallet: null };
    AccountLink.findOne = async () => link;

    const connectedAt = new Date('2026-04-25T12:00:00.000Z');

    Player.findOne = () => chainableQuery(makePlayer({
      wallet: 'tg_x9',
      xUserId: 'x_user_42',
      xUsername: 'xlinked_user',
      xConnectedAt: connectedAt
    }));

    const r = await get(baseUrl, '/api/x/status', { 'X-Primary-Id': 'tg_x9' });
    assert.equal(r.status, 200);
    assert.equal(r.body.connected, true);
    assert.equal(r.body.username, 'xlinked_user');
    assert.equal(r.body.connectedAt, connectedAt.toISOString());
  } finally {
    clearXOAuthEnv();
    server.close();
  }
});

test('POST /api/x/share-result - publishes post via connected X account', async () => {
  setXOAuthEnv();
  const { server, baseUrl } = await startServer();
  const origCreateTweet = xOAuthModule.createTweet;
  const origUploadMedia = xOAuthModule.uploadMedia;
  try {
    const link = {
      primaryId: 'tg_x10',
      telegramId: '10',
      wallet: '0x1111111111111111111111111111111111111111'
    };
    AccountLink.findOne = async () => link;

    const player = makePlayer({
      wallet: 'tg_x10',
      bestScore: 777,
      xUserId: 'x_user_10',
      xUsername: 'x_user_name',
      xAccessToken: 'token_1',
      xRefreshToken: 'refresh_1',
      referralCode: 'ABCD1234'
    });
    Player.findOne = () => chainableQuery({ ...player, save: async function() { return this; } });

    let sentText = '';
    let uploadedBufferSize = 0;
    xOAuthModule.uploadMedia = async (_token, mediaBuffer) => {
      uploadedBufferSize = Buffer.isBuffer(mediaBuffer) ? mediaBuffer.length : 0;
      return 'media_777';
    };
    xOAuthModule.createTweet = async (_token, payload) => {
      sentText = payload.text;
      assert.deepEqual(payload.media, { media_ids: ['media_777'] });
      return { id: '191919', text: payload.text };
    };

    const r = await post(baseUrl, '/api/x/share-result', {}, { 'X-Primary-Id': 'tg_x10' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.posted, true);
    assert.equal(r.body.tweetId, '191919');
    assert.equal(r.body.tweetUrl, 'https://x.com/x_user_name/status/191919');
    assert.ok(uploadedBufferSize > 0, 'should upload prepared PNG buffer');
    assert.match(sentText, /I scored 777 in Ursass Tube/);
    assert.match(sentText, /#UrsassTube/);
    assert.match(sentText, /\/api\/leaderboard\/share\/page\/0x1111111111111111111111111111111111111111/);
  } finally {
    xOAuthModule.createTweet = origCreateTweet;
    xOAuthModule.uploadMedia = origUploadMedia;
    clearXOAuthEnv();
    server.close();
  }
});

test('POST /api/x/share-result - refreshes access token on 401 and retries', async () => {
  setXOAuthEnv();
  const { server, baseUrl } = await startServer();
  const origCreateTweet = xOAuthModule.createTweet;
  const origUploadMedia = xOAuthModule.uploadMedia;
  const origRefresh = xOAuthModule.refreshAccessToken;
  try {
    const link = { primaryId: 'tg_x11', telegramId: '11', wallet: null };
    AccountLink.findOne = async () => link;

    const player = makePlayer({
      wallet: 'tg_x11',
      bestScore: 321,
      xUserId: 'x_user_11',
      xUsername: 'retry_user',
      xAccessToken: 'expired_token',
      xRefreshToken: 'refresh_token_11'
    });

    let saved = false;
    Player.findOne = () => chainableQuery({
      ...player,
      save: async function() { saved = true; return this; }
    });

    let attempts = 0;
    xOAuthModule.uploadMedia = async () => 'media_retry';
    xOAuthModule.createTweet = async (_token, payload) => {
      attempts += 1;
      if (attempts === 1) {
        const err = new Error('Unauthorized');
        err.response = { status: 401 };
        throw err;
      }
      assert.deepEqual(payload.media, { media_ids: ['media_retry'] });
      return { id: '202020', text: payload.text };
    };
    xOAuthModule.refreshAccessToken = async () => ({
      access_token: 'fresh_access',
      refresh_token: 'fresh_refresh'
    });

    const r = await post(baseUrl, '/api/x/share-result', {}, { 'X-Primary-Id': 'tg_x11' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.posted, true);
    assert.equal(r.body.tweetId, '202020');
    assert.equal(attempts, 2, 'should retry createTweet once after refresh');
    assert.equal(saved, true, 'should persist refreshed token');
  } finally {
    xOAuthModule.createTweet = origCreateTweet;
    xOAuthModule.uploadMedia = origUploadMedia;
    xOAuthModule.refreshAccessToken = origRefresh;
    clearXOAuthEnv();
    server.close();
  }
});

test('POST /api/x/share-result - returns 502 when media upload has no media_id', async () => {
  setXOAuthEnv();
  const { server, baseUrl } = await startServer();
  const origCreateTweet = xOAuthModule.createTweet;
  const origUploadMedia = xOAuthModule.uploadMedia;
  try {
    const link = { primaryId: 'tg_x12', telegramId: '12', wallet: null };
    AccountLink.findOne = async () => link;

    const player = makePlayer({
      wallet: 'tg_x12',
      bestScore: 654,
      xUserId: 'x_user_12',
      xUsername: 'no_media_user',
      xAccessToken: 'token_12',
      xRefreshToken: 'refresh_12'
    });

    Player.findOne = () => chainableQuery({ ...player, save: async function() { return this; } });

    xOAuthModule.uploadMedia = async () => '';
    xOAuthModule.createTweet = async () => {
      throw new Error('createTweet should not be called without media id');
    };

    const r = await post(baseUrl, '/api/x/share-result', {}, { 'X-Primary-Id': 'tg_x12' });
    assert.equal(r.status, 502);
    assert.equal(r.body.error, 'x_media_upload_failed');
    assert.equal(r.body.retryable, true);
    assert.equal(r.body.fallback, 'text_intent');
  } finally {
    xOAuthModule.createTweet = origCreateTweet;
    xOAuthModule.uploadMedia = origUploadMedia;
    clearXOAuthEnv();
    server.close();
  }
});


test('POST /api/x/share-result - maps 429 to x_rate_limited contract', async () => {
  setXOAuthEnv();
  const { server, baseUrl } = await startServer();
  const origUploadMedia = xOAuthModule.uploadMedia;
  try {
    const link = { primaryId: 'tg_x13', telegramId: '13', wallet: null };
    AccountLink.findOne = async () => link;

    const player = makePlayer({
      wallet: 'tg_x13',
      bestScore: 88,
      xUserId: 'x_user_13',
      xAccessToken: 'token_13',
      xRefreshToken: 'refresh_13'
    });
    Player.findOne = () => chainableQuery({ ...player, save: async function() { return this; } });

    xOAuthModule.uploadMedia = async () => {
      const err = new Error('rate limited');
      err.response = { status: 429 };
      throw err;
    };

    const r = await post(baseUrl, '/api/x/share-result', {}, { 'X-Primary-Id': 'tg_x13' });
    assert.equal(r.status, 429);
    assert.equal(r.body.error, 'x_rate_limited');
    assert.equal(r.body.retryable, true);
    assert.equal(r.body.fallback, 'text_intent');
  } finally {
    xOAuthModule.uploadMedia = origUploadMedia;
    clearXOAuthEnv();
    server.close();
  }
});

test('POST /api/x/share-result - maps 401 without refresh token to x_auth_expired', async () => {
  setXOAuthEnv();
  const { server, baseUrl } = await startServer();
  const origUploadMedia = xOAuthModule.uploadMedia;
  try {
    const link = { primaryId: 'tg_x14', telegramId: '14', wallet: null };
    AccountLink.findOne = async () => link;

    const player = makePlayer({
      wallet: 'tg_x14',
      bestScore: 42,
      xUserId: 'x_user_14',
      xAccessToken: 'expired_14',
      xRefreshToken: ''
    });
    Player.findOne = () => chainableQuery({ ...player, save: async function() { return this; } });

    xOAuthModule.uploadMedia = async () => {
      const err = new Error('unauthorized');
      err.response = { status: 401 };
      throw err;
    };

    const r = await post(baseUrl, '/api/x/share-result', {}, { 'X-Primary-Id': 'tg_x14' });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'x_auth_expired');
    assert.equal(r.body.retryable, false);
    assert.equal(r.body.fallback, null);
  } finally {
    xOAuthModule.uploadMedia = origUploadMedia;
    clearXOAuthEnv();
    server.close();
  }
});


test('POST /api/x/share-result - maps 403 insufficient scope to x_auth_expired', async () => {
  setXOAuthEnv();
  const { server, baseUrl } = await startServer();
  const origUploadMedia = xOAuthModule.uploadMedia;
  try {
    const link = { primaryId: 'tg_x15', telegramId: '15', wallet: null };
    AccountLink.findOne = async () => link;

    const player = makePlayer({
      wallet: 'tg_x15',
      bestScore: 7,
      xUserId: 'x_user_15',
      xAccessToken: 'token_15',
      xRefreshToken: 'refresh_15'
    });
    Player.findOne = () => chainableQuery({ ...player, save: async function() { return this; } });

    xOAuthModule.uploadMedia = async () => {
      const err = new Error('forbidden');
      err.response = { status: 403, data: { detail: 'missing media.write scope' } };
      throw err;
    };

    const r = await post(baseUrl, '/api/x/share-result', {}, { 'X-Primary-Id': 'tg_x15' });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, 'x_auth_expired');
    assert.equal(r.body.retryable, false);
    assert.equal(r.body.fallback, null);
  } finally {
    xOAuthModule.uploadMedia = origUploadMedia;
    clearXOAuthEnv();
    server.close();
  }
});
