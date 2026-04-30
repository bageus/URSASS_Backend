const SecurityEvent = require('../models/SecurityEvent');
const logger = require('./logger');

function normalizeWallet(wallet) {
  if (typeof wallet !== 'string') {
    return null;
  }

  const normalized = wallet.trim().toLowerCase();
  return normalized || null;
}

function isValidWalletAddress(wallet) {
  return typeof wallet === 'string' && /^0x[a-fA-F0-9]{40}$/.test(wallet);
}

function parseWalletOrNull(wallet) {
  const normalized = normalizeWallet(wallet);
  if (!normalized) {
    return null;
  }
  return isValidWalletAddress(normalized) ? normalized : null;
}

function buildInvalidWalletError(message = 'Invalid wallet format. Expected EVM wallet like 0x... (40 hex chars).') {
  return { error: message };
}

function validateTimestampWindow(timestamp, {
  windowMs,
  maxPastAgeMs,
  maxFutureSkewMs,
  now = Date.now()
} = {}) {
  const rawTs = typeof timestamp === 'number' ? timestamp : parseInt(timestamp, 10);

  if (!rawTs || Number.isNaN(rawTs)) {
    return { valid: false, error: 'Invalid timestamp format' };
  }

  const normalizedTs = rawTs < 1e12 ? rawTs * 1000 : rawTs;
  const ageMs = now - normalizedTs;
  const timeDiff = Math.abs(ageMs);

  if (typeof windowMs === 'number' && timeDiff > windowMs) {
    return { valid: false, error: `Invalid timestamp. Diff: ${timeDiff}ms`, normalizedTs, ageMs, timeDiff };
  }

  if (
    typeof maxPastAgeMs === 'number'
    && typeof maxFutureSkewMs === 'number'
    && (ageMs > maxPastAgeMs || ageMs < -maxFutureSkewMs)
  ) {
    return { valid: false, error: `Invalid timestamp. Age: ${ageMs}ms.`, normalizedTs, ageMs, timeDiff };
  }

  return { valid: true, normalizedTs, ageMs, timeDiff };
}

async function logSecurityEvent({ wallet = null, eventType, route, ipAddress, details = {} }) {
  try {
    await SecurityEvent.create({ wallet, eventType, route, ipAddress, details });
  } catch (error) {
    logger.warn({ error: error.message, eventType }, 'Failed to persist SecurityEvent');
  }
}

module.exports = {
  normalizeWallet,
  isValidWalletAddress,
  parseWalletOrNull,
  buildInvalidWalletError,
  validateTimestampWindow,
  logSecurityEvent
};
