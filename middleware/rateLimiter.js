const rateLimit = require('express-rate-limit');

// ✅ Rate limit для сохранения результатов
const saveResultLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 минута
  max: 10,  // максимум 10 запросов
  message: '❌ Слишком много запросов. Подождите перед отправкой следующего результата.',
  standardHeaders: true,
  legacyHeaders: false,
  // ✅ Используем X-Forwarded-For для Railway
  keyGenerator: (req) => {
    return req.get('x-forwarded-for') || req.ip || req.connection.remoteAddress;
  },
  skip: (req) => {
    return req.path === '/health';
  }
});

// ✅ Rate limit для получения лидерборда
const leaderboardLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: '❌ Слишком много запросов к лидерборду.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.get('x-forwarded-for') || req.ip || req.connection.remoteAddress;
  }
});

module.exports = {
  saveResultLimiter,
  leaderboardLimiter
};
