const express = require('express');
const router = express.Router();

const { getOrCreateTelegramAccount } = require('../utils/accountManager');
const {
  createTelegramStarsPayment,
  handleTelegramPreCheckoutQuery,
  handleTelegramSuccessfulPayment
} = require('../utils/donationService');
const { validateTelegramInitData } = require('../utils/telegramAuth');
const { writeLimiter, readLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');
const { logSecurityEvent } = require('../utils/security');

function resolveInitData(req) {
  return req.body?.telegramInitData
    || req.body?.initData
    || req.get('x-telegram-init-data')
    || '';
}

router.post('/donations/stars/create', writeLimiter, async (req, res) => {
  try {
    const { productKey } = req.body || {};
    const initData = resolveInitData(req);
    const validation = validateTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN);

    if (!validation.valid) {
      return res.status(401).json({ error: validation.error });
    }

    const account = await getOrCreateTelegramAccount(validation.user.id);
    if (account.telegramId !== String(validation.user.id)) {
      return res.status(403).json({ error: 'Telegram session mismatch' });
    }

    const { payment, invoiceUrl } = await createTelegramStarsPayment({
      telegramUserId: validation.user.id,
      productKey
    });

    await logSecurityEvent({
      wallet: payment.wallet,
      eventType: 'donation_stars_order_created',
      route: req.path,
      ipAddress: req.ip,
      details: {
        orderId: payment.paymentId,
        telegramUserId: payment.telegramUserId,
        productKey: payment.productKey,
        starsAmount: payment.starsAmount
      }
    });

    res.status(201).json({
      orderId: payment.paymentId,
      invoiceUrl
    });
  } catch (error) {
    logger.error({ err: error }, 'POST /donations/stars/create error');
    res.status(error.statusCode || 500).json({ error: error.message || 'Server error' });
  }
});

router.post('/telegram/webhook', readLimiter, async (req, res) => {
  try {
    const update = req.body || {};
    logger.info({ updateId: update.update_id || null, keys: Object.keys(update) }, 'Telegram payment webhook update received');

    if (update.pre_checkout_query) {
      const result = await handleTelegramPreCheckoutQuery(update);
      return res.json({ ok: true, type: 'pre_checkout_query', result });
    }

    if (update.message?.successful_payment) {
      const result = await handleTelegramSuccessfulPayment(update);
      return res.json({ ok: true, type: 'successful_payment', result: { ok: result.ok, orderId: result.order?.paymentId || null } });
    }

    res.json({ ok: true, ignored: true });
  } catch (error) {
    logger.error({ err: error, body: req.body }, 'POST /telegram/webhook error');
    res.status(error.statusCode || 500).json({ error: error.message || 'Server error' });
  }
});

module.exports = router;
