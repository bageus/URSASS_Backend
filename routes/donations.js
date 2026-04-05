const express = require('express');
const router = express.Router();

const { getOrCreateTelegramAccount } = require('../utils/accountManager');
const {
  createTelegramStarsPayment,
  handleTelegramPreCheckoutQuery,
  handleTelegramSuccessfulPayment,
  confirmTelegramStarsPayment
} = require('../utils/donationService');
const { validateTelegramInitData } = require('../utils/telegramAuth');
const { writeLimiter, readLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');
const { logSecurityEvent } = require('../utils/security');
const { verifyTelegramWebhook } = require('../middleware/telegramWebhookAuth');

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
    logger.error({ err: error, code: error.code, details: error.details || null }, 'POST /donations/stars/create error');
    res.status(error.statusCode || 500).json({
      error: error.message || 'Server error',
      code: error.code || 'server_error',
      ...(error.details ? { details: error.details } : {})
    });
  }
});


router.post('/donations/stars/confirm', writeLimiter, async (req, res) => {
  try {
    const { orderId, paymentId, totalAmount, currency } = req.body || {};
    const initData = resolveInitData(req);
    const validation = validateTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN);

    if (!validation.valid) {
      return res.status(401).json({ error: validation.error });
    }

    const account = await getOrCreateTelegramAccount(validation.user.id);
    if (account.telegramId !== String(validation.user.id)) {
      return res.status(403).json({ error: 'Telegram session mismatch' });
    }

    const result = await confirmTelegramStarsPayment({
      orderId: orderId || paymentId,
      telegramUserId: validation.user.id,
      totalAmount,
      currency,
      source: 'telegram_invoice_callback'
    });

    await logSecurityEvent({
      wallet: result.order.wallet,
      eventType: 'donation_stars_order_confirmed',
      route: req.path,
      ipAddress: req.ip,
      details: {
        orderId: result.order.paymentId,
        telegramUserId: result.order.telegramUserId,
        productKey: result.order.productKey,
        starsAmount: result.order.starsAmount,
        recovered: result.recovered
      }
    });

    res.json({
      ok: result.ok,
      recovered: result.recovered,
      order: result.order ? {
        orderId: result.order.paymentId,
        paymentId: result.order.paymentId,
        status: result.order.status,
        rewardGrantedAt: result.order.rewardGrantedAt || null
      } : null
    });
  } catch (error) {
    logger.error({ err: error, code: error.code, details: error.details || null }, 'POST /donations/stars/confirm error');
    res.status(error.statusCode || 500).json({
      error: error.message || 'Server error',
      code: error.code || 'server_error',
      ...(error.details ? { details: error.details } : {})
    });
  }
});

router.post('/telegram/webhook', readLimiter, verifyTelegramWebhook, async (req, res) => {
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
