const { normalizeWallet } = require('./security');

// AI_WHITELIST_START
// add allowed wallets here (lowercase)
const AI_MODE_WALLET_WHITELIST = [
  // '0x1234...abcd',
  '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '0x6735646dba76763695be5395bf2f4245046db44c',
  '0x293c0acd14b57140daef22945bdefd5afd55e951',
  '0xc17f095698a93c89b572c225393effdd80e83823',
  '0x463000d910267073636e387e9bd9bb6dce6442b9',
  '0x8bca974e142fe45fc3cf302228b277ffa1fa9d50',
  '0xaa43de477256141e5432f49d654d64a6cf3c96ed',
  '0x82cd227ee2f96657f66dfd9084d97eb599304b8d',
  '0x8b090ec38c7835323520bee4657713af5bdeeebe',
  '0x230f807129cd3c1a8ad22acf59ce35b2b7b71c82',
  '0x24ab5420e6859916bd055049fcf2bef09f33bc1b',
  '0x42e987d29603022a6f67ae55ef82f26f00a13be4',
  '0x6b75107f95a2f60c7557dc2ce8ffd905f99bd0d3',
  '0xe40f9621fbcc603f2b455dd0ead9d95f1ee73f8b',
  '0x2192d974928bbd37f5c4f2c492fc912414b6c1f1',
  '0x43508390984448e2ceba52bc004e1dae4471b1c4',
  '0xc5df6cf50c95d1a5c44c81a60bc367630b5294b6',
  '0xe229c24b905a93e1b7d4694e2b7c2bb62c524929',
  '0xc1e868935e8f529c755859528b8555cee9fce5c0',
  '0xd9066a47c2492c1a4a4c90e322d15e2b5f40fd2d',
  '0x9170acc70ecef915641642b03e6529a3782fea3d',
  '0xad0d3ce7bf05b927f4a712036db74b5c6464ba19',
  '0x1c542f5386c8e8f35c46812d63aa0d26813d2695',
  '0xe13b2b6e860438d740394e062d3950ff6690e9ab',
  '0x2cbe5c1a1fe9f8b3192165e522215b23acbbd385'
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
