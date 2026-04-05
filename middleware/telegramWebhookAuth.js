const crypto = require('crypto');

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

function verifyTelegramWebhook(req, res, next) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!expectedSecret) {
    return next();
  }

  const providedSecret = req.get('x-telegram-bot-api-secret-token')
    || req.get('x-telegram-webhook-secret')
    || req.query?.secret
    || req.body?.secret
    || null;

  if (!providedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
    return res.status(401).json({ error: 'Invalid Telegram webhook secret' });
  }

  return next();
}

module.exports = {
  verifyTelegramWebhook
};
