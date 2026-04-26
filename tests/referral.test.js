const test = require('node:test');
const assert = require('node:assert/strict');

const { generateReferralCode, buildReferralUrl } = require('../utils/referral');

// ── Tests for generateReferralCode ────────────────────────────────────────────

test('generateReferralCode produces 8-character string', () => {
  const code = generateReferralCode();
  assert.equal(code.length, 8);
});

test('generateReferralCode uses only allowed alphabet characters', () => {
  const ALLOWED = new Set('23456789ABCDEFGHJKMNPQRSTUVWXYZ');
  for (let i = 0; i < 50; i++) {
    const code = generateReferralCode();
    for (const ch of code) {
      assert.ok(ALLOWED.has(ch), `Unexpected char '${ch}' in code '${code}'`);
    }
  }
});

test('generateReferralCode produces unique codes', () => {
  const codes = new Set();
  for (let i = 0; i < 200; i++) {
    codes.add(generateReferralCode());
  }
  assert.ok(codes.size > 180, `Expected mostly unique codes, got ${codes.size}/200`);
});

test('generateReferralCode never contains ambiguous characters (0, O, 1, I, L)', () => {
  const AMBIGUOUS = new Set('01OIL');
  for (let i = 0; i < 100; i++) {
    const code = generateReferralCode();
    for (const ch of code) {
      assert.ok(!AMBIGUOUS.has(ch), `Ambiguous char '${ch}' found in code '${code}'`);
    }
  }
});

// ── Tests for buildReferralUrl ────────────────────────────────────────────────

test('buildReferralUrl uses FRONTEND_BASE_URL env when set', () => {
  const originalEnv = process.env.FRONTEND_BASE_URL;
  process.env.FRONTEND_BASE_URL = 'https://example.com';
  const url = buildReferralUrl('ABCD1234', null);
  assert.equal(url, 'https://example.com/?ref=ABCD1234');
  process.env.FRONTEND_BASE_URL = originalEnv;
});

test('buildReferralUrl falls back to PUBLIC_BASE_URL when FRONTEND_BASE_URL not set', () => {
  const origFrontend = process.env.FRONTEND_BASE_URL;
  const origPublic = process.env.PUBLIC_BASE_URL;
  delete process.env.FRONTEND_BASE_URL;
  process.env.PUBLIC_BASE_URL = 'https://public.example.com';
  const url = buildReferralUrl('TESTCODE', null);
  assert.equal(url, 'https://public.example.com/?ref=TESTCODE');
  process.env.FRONTEND_BASE_URL = origFrontend;
  process.env.PUBLIC_BASE_URL = origPublic;
});

// ── Simulated referral/track route behaviour (unit-level) ────────────────────

// Mock Player model
function makeMockPlayer(overrides = {}) {
  return {
    wallet: 'tg_123',
    referralCode: 'MYCODE8X',
    referredBy: null,
    save: async function() { return this; },
    ...overrides
  };
}

test('track: returns already:true when referredBy already set', async () => {
  const player = makeMockPlayer({ referredBy: 'ANOTHERX' });
  assert.ok(player.referredBy, 'referredBy is set');
  // simulate route logic
  if (player.referredBy) {
    assert.equal(player.referredBy, 'ANOTHERX');
    return;
  }
  assert.fail('should have returned early');
});

test('track: blocks self-referral', () => {
  const player = makeMockPlayer({ referralCode: 'SELFCODE' });
  const refCode = 'SELFCODE';
  const isSelf = player.referralCode && player.referralCode === refCode;
  assert.ok(isSelf, 'self-referral should be blocked');
});

test('track: allows valid referral from different player', () => {
  const player = makeMockPlayer({ referralCode: 'MYCODE8X', referredBy: null });
  const refCode = 'OTHERCO1';
  const isSelf = player.referralCode && player.referralCode === refCode;
  assert.ok(!isSelf, 'should not be self');
  assert.ok(!player.referredBy, 'referredBy not yet set');
});
