const test = require('node:test');
const assert = require('node:assert/strict');

const AccountLink = require('../models/AccountLink');
const { shouldCountAuthenticatedRun } = require('../services/onboardingService');

test('shouldCountAuthenticatedRun returns false when no account link exists', async () => {
  const original = AccountLink.findOne;
  AccountLink.findOne = () => ({ select: async () => null });
  try {
    const result = await shouldCountAuthenticatedRun('guest_123');
    assert.equal(result, false);
  } finally {
    AccountLink.findOne = original;
  }
});

test('shouldCountAuthenticatedRun returns true when account link exists', async () => {
  const original = AccountLink.findOne;
  AccountLink.findOne = () => ({ select: async () => ({ _id: 'mock-id' }) });
  try {
    const result = await shouldCountAuthenticatedRun('0xabc');
    assert.equal(result, true);
  } finally {
    AccountLink.findOne = original;
  }
});
