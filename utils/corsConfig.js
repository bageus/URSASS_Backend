function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isAllowedPreviewOrigin(origin, mode) {
  if (!origin) return false;
  if (mode === 'none') return false;

  if (mode === 'strict') {
    return /^https:\/\/[a-z0-9-]+-ursass-tube\.vercel\.app$/i.test(origin);
  }

  // wildcard mode (backward compatibility)
  return origin.endsWith('.vercel.app');
}

function createCorsOriginValidator(env = process.env) {
  const extraAllowedOrigins = parseCsv(env.CORS_ALLOWED_ORIGINS);
  const previewMode = (env.CORS_PREVIEW_MODE || 'none').toLowerCase();

  const allowedOrigins = new Set([
    'https://bageus.github.io',
    'https://ursass-tube.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    ...extraAllowedOrigins
  ]);

  return function isAllowedOrigin(origin) {
    if (!origin) return true;
    if (allowedOrigins.has(origin)) return true;
    return isAllowedPreviewOrigin(origin, previewMode);
  };
}

module.exports = {
  parseCsv,
  isAllowedPreviewOrigin,
  createCorsOriginValidator
};
