const { normalizeWallet } = require('./security');

// AI_WHITELIST_START
// add allowed wallets here (lowercase)
const AI_MODE_WALLET_WHITELIST = [
  // '0x1234...abcd',
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
];
// AI_WHITELIST_END

const AI_MODE_PRIORITIES = new Set(['gold', 'silver', 'bonus', 'score', 'different']);

function hasAiModeAccess(wallet) {
  const normalized = normalizeWallet(wallet);
  return Boolean(normalized) && AI_MODE_WALLET_WHITELIST.includes(normalized);
}

function validateAiSettings(aiSettings) {
  if (aiSettings == null) {
    return { valid: true, sanitized: null };
  }

  if (typeof aiSettings !== 'object' || Array.isArray(aiSettings)) {
    return { valid: false, error: 'aiSettings must be an object' };
  }

  const enabled = aiSettings.enabled;
  const distance = aiSettings.distance ?? 0;
  const spinCount = aiSettings.spinCount ?? 0;
  const combo = aiSettings.combo ?? false;
  const priority = aiSettings.priority ?? 'different';

  if (typeof enabled !== 'boolean') {
    return { valid: false, error: 'aiSettings.enabled must be boolean' };
  }

  if (!Number.isInteger(distance) || distance < 0) {
    return { valid: false, error: 'aiSettings.distance must be integer >= 0' };
  }

  if (!Number.isInteger(spinCount) || spinCount < 0) {
    return { valid: false, error: 'aiSettings.spinCount must be integer >= 0' };
  }

  if (typeof combo !== 'boolean') {
    return { valid: false, error: 'aiSettings.combo must be boolean' };
  }

  if (typeof priority !== 'string' || !AI_MODE_PRIORITIES.has(priority)) {
    return { valid: false, error: 'aiSettings.priority must be one of: gold, silver, bonus, score, different' };
  }

  return {
    valid: true,
    sanitized: { enabled, distance, spinCount, combo, priority }
  };
}

module.exports = {
  hasAiModeAccess,
  validateAiSettings
};
