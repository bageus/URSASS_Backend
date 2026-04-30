const test = require('node:test');
const assert = require('node:assert/strict');
const { CACHE_CLASS, getCachePolicy } = require('../services/cachePolicyService');

test('cache policy classifies leaderboard top as public volatile', () => {
  assert.equal(getCachePolicy('/api/leaderboard/top'), CACHE_CLASS.PUBLIC_VOLATILE);
});

test('cache policy classifies account profile as personalized', () => {
  assert.equal(getCachePolicy('/api/v1/account/me/profile'), CACHE_CLASS.PERSONALIZED);
});

test('cache policy classifies save routes as transactional', () => {
  assert.equal(getCachePolicy('/api/leaderboard/save'), CACHE_CLASS.TRANSACTIONAL);
});
