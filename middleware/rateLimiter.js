const rateLimit = require('express-rate-limit');

// ✅ Rate limit для сохранения результатов (максимум 10 результатов в минуту с одного IP)
const saveResultLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,  // 1 минута
  max: 10,  // максимум 10 запросов
  message: '❌ Слишком много запросов. Подождите перед отправкой следующего результата.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Пропускаем rate limit для проверки здоровья сервера
    return req.path === '/health';
  }
});

// ✅ Rate limit для получения лидерборда (мягче - 100 запросов в минуту)
const leaderboardLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: '❌ Слишком много запросов к лидерборду.',
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  saveResultLimiter,
  leaderboardLimiter
};
