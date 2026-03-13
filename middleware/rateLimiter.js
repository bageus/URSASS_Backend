const rateLimit = require('express-rate-limit');

const getClientIp = (req) => req.get('x-forwarded-for') || req.ip || req.connection.remoteAddress;

// ✅ Строгий лимит для отправки игровых результатов
const saveResultLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5,  
  message: '❌ Слишком много попыток отправки результатов. Подождите минуту.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp,
  skip: (req) => {
    return req.path === '/health';
  }
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
  readLimiter
};
