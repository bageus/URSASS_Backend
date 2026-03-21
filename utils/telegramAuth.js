const crypto = require('crypto');

const DEFAULT_MAX_AGE_SECONDS = Math.max(60, Number(process.env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS || 24 * 60 * 60));

function getSecretKey(botToken) {
  return crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
}

function buildDataCheckString(params) {
  return [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function validateTelegramInitData(initData, botToken, options = {}) {
  if (!initData || typeof initData !== 'string') {
    return { valid: false, error: 'Missing Telegram init data' };
  }

  if (!botToken) {
    return { valid: false, error: 'Telegram bot token is not configured' };
  }

  const params = new URLSearchParams(initData);
  const providedHash = params.get('hash');
  const authDateRaw = params.get('auth_date');
  const userRaw = params.get('user');

  if (!providedHash || !authDateRaw || !userRaw) {
    return { valid: false, error: 'Incomplete Telegram init data' };
  }

  const dataCheckString = buildDataCheckString(params);
  const expectedHash = crypto
    .createHmac('sha256', getSecretKey(botToken))
    .update(dataCheckString)
    .digest('hex');

  if (expectedHash !== providedHash) {
    return { valid: false, error: 'Telegram init data hash mismatch' };
  }

  const authDateSeconds = Number(authDateRaw);
  if (!Number.isFinite(authDateSeconds)) {
    return { valid: false, error: 'Invalid Telegram auth_date' };
  }

  const nowSeconds = Math.floor((options.nowMs || Date.now()) / 1000);
  const maxAgeSeconds = Math.max(60, Number(options.maxAgeSeconds || DEFAULT_MAX_AGE_SECONDS));
  if (Math.abs(nowSeconds - authDateSeconds) > maxAgeSeconds) {
    return { valid: false, error: 'Telegram init data expired' };
  }

  let user;
  try {
    user = JSON.parse(userRaw);
  } catch (error) {
    return { valid: false, error: 'Invalid Telegram user payload' };
  }

  if (!user || !user.id) {
    return { valid: false, error: 'Telegram user id missing in init data' };
  }

  return {
    valid: true,
    user,
    authDate: authDateSeconds,
    raw: initData,
    queryId: params.get('query_id') || null
  };
}

module.exports = {
  validateTelegramInitData
};
