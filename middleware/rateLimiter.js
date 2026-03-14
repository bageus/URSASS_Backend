const rateLimit = require('express-rate-limit');

function parseClientIp(req) {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) {
    const trusted = forwarded
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)[0];

    if (trusted) {
      return trusted;
    }
  }

  return req.ip || req.connection?.remoteAddress || 'unknown';
}

const keyGenerator = (req) => parseClientIp(req);

// ✅ Строгий лимит для отправки игровых результатов
const saveResultLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5,
  message: '❌ Слишком много попыток отправки результатов. Подождите минуту.',
  standardHeaders: true,
  legacyHeaders: false,
   keyGenerator,
    skip: (req) => req.path === '/health'
  });

// ✅ Умеренный лимит для write-операций, не связанных с сохранением результата
const writeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: '❌ Слишком много запросов на изменение данных. Попробуйте позже.',
  standardHeaders: true,
  legacyHeaders: false,
   keyGenerator
});

// ✅ Отдельный лимит для auth-endpoints
const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 15,
  message: '❌ Слишком много попыток авторизации. Попробуйте позже.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator
});

// ✅ Мягкий лимит для GET/чтения
const readLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  message: '❌ Слишком много запросов на чтение данных.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator
});

module.exports = {
  parseClientIp,
  saveResultLimiter,
  writeLimiter,
  authLimiter,
  readLimiter
};
