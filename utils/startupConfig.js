function normalizeList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateStartupConfig(env = process.env) {
  const mode = String(env.NODE_ENV || 'development').toLowerCase();
  const isProduction = mode === 'production';

  const errors = [];
  const warnings = [];

  const requiredInProduction = [
    'MONGO_URL',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_BOT_SECRET',
    'TELEGRAM_WEBHOOK_SECRET'
  ];

  if (isProduction) {
    requiredInProduction.forEach((name) => {
      if (!String(env[name] || '').trim()) {
        errors.push(`Missing required env var in production: ${name}`);
      }
    });
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
