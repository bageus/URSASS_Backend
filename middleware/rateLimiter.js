const rateLimit = require('express-rate-limit');

function getClientIp(req) {
  const xForwardedFor = req.get('x-forwarded-for');

  if (xForwardedFor && typeof xForwardedFor === 'string') {
    const firstIp = xForwardedFor
      .split(',')
      .map((value) => value.trim())
      .find(Boolean);

    if (firstIp) {
      return firstIp;
    }
  }

  return req.ip || req.connection.remoteAddress || 'unknown';
}

// ✅ Строгий лимит для отправки игровых результатов
const saveResultLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5,  
  message: '❌ Слишком много попыток отправки результатов. Подождите минуту.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp
});

// ✅ Умеренный лимит для write-операций, не связанных с сохранением результата
const writeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: '❌ Слишком много запросов на изменение данных. Попробуйте позже.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp
});

// ✅ Более строгий лимит для верификации Telegram-кодов
const verifyTelegramLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5,
  message: '❌ Слишком много попыток подтверждения Telegram-кода. Попробуйте позже.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const clientIp = getClientIp(req);
    const telegramId = req.body && req.body.telegramId ? String(req.body.telegramId).trim() : 'unknown';
    return `${clientIp}:${telegramId}`;
  }
});

// ✅ Мягкий лимит для GET/чтения
const readLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  message: '❌ Слишком много запросов на чтение данных.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp
});

module.exports = {
  saveResultLimiter,
  writeLimiter,
  readLimiter,
  verifyTelegramLimiter
};
