const test = require('node:test');
const assert = require('node:assert/strict');

const SecurityEvent = require('../models/SecurityEvent');
const logger = require('../utils/logger');
const { normalizeWallet, validateTimestampWindow, logSecurityEvent } = require('../utils/security');

test('normalizeWallet trims and lowercases wallet string', () => {
  assert.equal(normalizeWallet('  0xAbC123  '), '0xabc123');
  assert.equal(normalizeWallet(''), null);
  assert.equal(normalizeWallet(null), null);
});

test('validateTimestampWindow supports seconds timestamps in fixed window mode', () => {
  const now = 1_700_000_000_000;
  const timestampSeconds = Math.floor((now - 45_000) / 1000);

  const result = validateTimestampWindow(timestampSeconds, { now, windowMs: 60_000 });

  assert.equal(result.valid, true);
  assert.equal(result.normalizedTs, timestampSeconds * 1000);
  assert.equal(result.timeDiff, 45_000);
});

test('validateTimestampWindow rejects invalid format', () => {
  const result = validateTimestampWindow('bad-ts');

  assert.equal(result.valid, false);
  assert.equal(result.error, 'Invalid timestamp format');
});

test('validateTimestampWindow enforces asymmetric past/future limits', () => {
  const now = 1_700_000_000_000;
  const tooOld = now - 11_000;

  const oldResult = validateTimestampWindow(tooOld, {
    now,
    maxPastAgeMs: 10_000,
    maxFutureSkewMs: 5_000
  });

  assert.equal(oldResult.valid, false);
  assert.equal(oldResult.error, `Invalid timestamp. Age: ${oldResult.ageMs}ms.`);

  const tooFuture = now + 6_000;
  const futureResult = validateTimestampWindow(tooFuture, {
    now,
    maxPastAgeMs: 10_000,
    maxFutureSkewMs: 5_000
  });

  assert.equal(futureResult.valid, false);
  assert.equal(futureResult.error, `Invalid timestamp. Age: ${futureResult.ageMs}ms.`);
});

test('logSecurityEvent persists data', async () => {
  const originalCreate = SecurityEvent.create;
  const originalWarn = logger.warn;
  const captured = [];

  try {
    SecurityEvent.create = async (payload) => {
      captured.push(payload);
      return payload;
    };
    logger.warn = () => assert.fail('logger.warn should not be called on success');

    await logSecurityEvent({
      wallet: '0xabc',
      eventType: 'unit_test_event',
      route: '/test',
      ipAddress: '127.0.0.1',
      details: { ok: true }
    });

    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0], {
      wallet: '0xabc',
      eventType: 'unit_test_event',
      route: '/test',
      ipAddress: '127.0.0.1',
      details: { ok: true }
    });
  } finally {
    SecurityEvent.create = originalCreate;
    logger.warn = originalWarn;
  }
});

test('logSecurityEvent swallows persistence error and logs warning', async () => {
  const originalCreate = SecurityEvent.create;
  const originalWarn = logger.warn;
  const warnings = [];

  try {
    SecurityEvent.create = async () => {
      throw new Error('db down');
    };
    logger.warn = (payload, message) => warnings.push({ payload, message });

    await logSecurityEvent({ eventType: 'failure_case', route: '/test', ipAddress: '127.0.0.1' });

    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].message, 'Failed to persist SecurityEvent');
    assert.equal(warnings[0].payload.error, 'db down');
    assert.equal(warnings[0].payload.eventType, 'failure_case');
  } finally {
    SecurityEvent.create = originalCreate;
    logger.warn = originalWarn;
  }
});
