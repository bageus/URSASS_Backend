const test = require('node:test');
const assert = require('node:assert/strict');
const { parseClientIp } = require('../middleware/rateLimiter');

function mockReq({ forwarded, ip, remoteAddress } = {}) {
  return {
    get: (name) => (name === 'x-forwarded-for' ? forwarded : undefined),
    ip,
    connection: { remoteAddress }
  };
}

test('parseClientIp should use req.ip even if x-forwarded-for exists', () => {
  const ip = parseClientIp(mockReq({ forwarded: '203.0.113.1, 10.0.0.2', ip: '127.0.0.1' }));
  assert.equal(ip, '127.0.0.1');
});

test('parseClientIp should fallback to req.ip', () => {
  const ip = parseClientIp(mockReq({ ip: '127.0.0.1' }));
  assert.equal(ip, '127.0.0.1');
});

test('parseClientIp should fallback to remote address', () => {
  const ip = parseClientIp(mockReq({ remoteAddress: '::1' }));
  assert.equal(ip, '::1');
});
