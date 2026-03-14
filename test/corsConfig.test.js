const test = require('node:test');
const assert = require('node:assert/strict');
const { createCorsOriginValidator } = require('../utils/corsConfig');

test('allows explicit allowlist origins', () => {
  const isAllowed = createCorsOriginValidator({ CORS_ALLOWED_ORIGINS: 'https://app.example.com' });
  assert.equal(isAllowed('https://app.example.com'), true);
});

test('blocks arbitrary vercel origin by default', () => {
  const isAllowed = createCorsOriginValidator({ CORS_PREVIEW_MODE: 'none' });
  assert.equal(isAllowed('https://random-preview.vercel.app'), false);
});

test('allows strict preview pattern when enabled', () => {
  const isAllowed = createCorsOriginValidator({ CORS_PREVIEW_MODE: 'strict' });
  assert.equal(isAllowed('https://feature-ursass-tube.vercel.app'), true);
  assert.equal(isAllowed('https://feature-unknown.vercel.app'), false);
});
