const test = require('node:test');
const assert = require('node:assert/strict');

const AccountLink = require('../models/AccountLink');
const { requireAuth } = require('../middleware/requireAuth');
const { signSessionToken } = require('../utils/sessionToken');

function makeReqRes(headers = {}) {
  const req = { _headers: headers, get(name) { return this._headers[name.toLowerCase()] || this._headers[name] || undefined; } };
  let statusCode = null; let jsonBody = null; let called = false;
  const res = { status(c){statusCode=c;return this;}, json(b){jsonBody=b;return this;}, getStatus:()=>statusCode, getJson:()=>jsonBody };
  const next = () => { called = true; };
  return { req, res, next, called: () => called };
}

test('requireAuth accepts valid Bearer session token', async () => {
  process.env.SESSION_SECRET = 'test-secret';
  const token = signSessionToken({ primaryId: 'tg_valid', authMode: 'wallet' });
  const orig = AccountLink.findOne;
  AccountLink.findOne = async (q) => q.primaryId === 'tg_valid' ? { primaryId: 'tg_valid', wallet: '0x1' } : null;
  const { req, res, next, called } = makeReqRes({ authorization: `Bearer ${token}` });
  await requireAuth(req, res, next);
  assert.equal(called(), true);
  assert.equal(req.primaryId, 'tg_valid');
  assert.equal(res.getStatus(), null);
  AccountLink.findOne = orig;
});

test('requireAuth rejects missing Authorization', async () => {
  process.env.ALLOW_LEGACY_HEADER_AUTH = 'false';
  const { req, res, next, called } = makeReqRes({});
  await requireAuth(req, res, next);
  assert.equal(called(), false);
  assert.equal(res.getStatus(), 401);
});

test('requireAuth rejects forged token', async () => {
  process.env.SESSION_SECRET = 'test-secret';
  const { req, res, next } = makeReqRes({ authorization: 'Bearer abc.def' });
  await requireAuth(req, res, next);
  assert.equal(res.getStatus(), 401);
});

test('requireAuth rejects expired token', async () => {
  process.env.SESSION_SECRET = 'test-secret';
  process.env.SESSION_TTL_SECONDS = '-1';
  const token = signSessionToken({ primaryId: 'tg_expired', authMode: 'wallet' });
  process.env.SESSION_TTL_SECONDS = '604800';
  const { req, res, next } = makeReqRes({ authorization: `Bearer ${token}` });
  await requireAuth(req, res, next);
  assert.equal(res.getStatus(), 401);
});

test('requireAuth rejects simple Bearer primaryId string', async () => {
  const { req, res } = makeReqRes({ authorization: 'Bearer tg_plain' });
  await requireAuth(req, res, () => {});
  assert.equal(res.getStatus(), 401);
});

test('requireAuth rejects X-Primary-Id only when legacy disabled', async () => {
  process.env.ALLOW_LEGACY_HEADER_AUTH = 'false';
  const { req, res } = makeReqRes({ 'x-primary-id': 'tg_plain' });
  await requireAuth(req, res, () => {});
  assert.equal(res.getStatus(), 401);
});
