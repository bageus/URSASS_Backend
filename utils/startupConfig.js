function normalizeList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isTrue(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function validateStartupConfig(env = process.env) {
  const mode = String(env.NODE_ENV || 'development').toLowerCase();
  const isProduction = mode === 'production';

  const errors = [];
  const warnings = [];

  if (isProduction && !String(env.MONGO_URL || '').trim()) {
    errors.push('Missing required env var in production: MONGO_URL');
  }

  const telegramRequired = isTrue(env.REQUIRE_TELEGRAM_CONFIG);
  const telegramVars = [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_BOT_SECRET',
    'TELEGRAM_WEBHOOK_SECRET'
  ];

  const missingTelegramVars = telegramVars.filter((name) => !String(env[name] || '').trim());

  if (missingTelegramVars.length > 0) {
    if (telegramRequired) {
      missingTelegramVars.forEach((name) => {
        errors.push(`Missing required env var in production: ${name}`);
      });
    } else if (isProduction) {
      warnings.push(`Telegram config is incomplete (${missingTelegramVars.join(', ')}). Telegram auth/webhook/stars features may be unavailable.`);
    }
  }

  const allowedOrigins = normalizeList(env.CORS_ALLOWED_ORIGINS);
  const localhostOrigins = allowedOrigins.filter((origin) => origin.includes('localhost') || origin.includes('127.0.0.1'));

  if (isProduction && allowedOrigins.length === 0) {
    warnings.push('CORS_ALLOWED_ORIGINS is empty in production; only built-in origins will be accepted.');
  }

  if (localhostOrigins.length > 0) {
    warnings.push(`Local origins present in CORS_ALLOWED_ORIGINS: ${localhostOrigins.join(', ')}`);
  }

  return {
    isProduction,
    errors,
    warnings
  };
}

module.exports = {
  validateStartupConfig
};
