const test = require('node:test');
const assert = require('node:assert/strict');

const { validateStartupConfig } = require('../utils/startupConfig');

test('validateStartupConfig returns production errors for missing required vars', () => {
  const result = validateStartupConfig({ NODE_ENV: 'production' });

  assert.equal(result.isProduction, true);
  assert.ok(result.errors.some((item) => item.includes('MONGO_URL')));
  assert.ok(result.errors.some((item) => item.includes('TELEGRAM_BOT_TOKEN')));
  assert.ok(result.errors.some((item) => item.includes('TELEGRAM_BOT_SECRET')));
  assert.ok(result.errors.some((item) => item.includes('TELEGRAM_WEBHOOK_SECRET')));
});

test('validateStartupConfig warns on localhost origins', () => {
  const result = validateStartupConfig({
    NODE_ENV: 'production',
    MONGO_URL: 'mongodb://localhost:27017/db',
    TELEGRAM_BOT_TOKEN: 'token',
    TELEGRAM_BOT_SECRET: 'secret',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
    CORS_ALLOWED_ORIGINS: 'https://example.com,http://localhost:3000'
  });

  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.some((item) => item.includes('localhost')));
});
