const logger = require('./logger');

let telegramStarsClient = {
  async createInvoiceLink(payload) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      const error = new Error('Telegram bot token is not configured');
      error.statusCode = 500;
      throw error;
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/createInvoiceLink`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok || !data.ok || !data.result) {
      logger.error({ status: response.status, response: data }, 'Telegram createInvoiceLink failed');
      const error = new Error(data.description || 'Failed to create Telegram invoice link');
      error.statusCode = 502;
      throw error;
    }

    return data.result;
  },

  async answerPreCheckoutQuery(preCheckoutQueryId, ok, errorMessage = undefined) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      const error = new Error('Telegram bot token is not configured');
      error.statusCode = 500;
      throw error;
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/answerPreCheckoutQuery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pre_checkout_query_id: preCheckoutQueryId,
        ok,
        ...(ok ? {} : { error_message: errorMessage || 'Payment validation failed' })
      })
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      logger.error({ status: response.status, response: data, preCheckoutQueryId, ok }, 'Telegram answerPreCheckoutQuery failed');
      const error = new Error(data.description || 'Failed to answer Telegram pre-checkout query');
      error.statusCode = 502;
      throw error;
    }

    return true;
  }
};

function setTelegramStarsClientForTests(client) {
  telegramStarsClient = client || telegramStarsClient;
}

function resetTelegramStarsClient() {
  delete require.cache[require.resolve('./telegramStarsService')];
}

async function createTelegramStarsInvoiceLink(payload) {
  return telegramStarsClient.createInvoiceLink(payload);
}

async function answerTelegramPreCheckoutQuery(preCheckoutQueryId, ok, errorMessage) {
  return telegramStarsClient.answerPreCheckoutQuery(preCheckoutQueryId, ok, errorMessage);
}

module.exports = {
  createTelegramStarsInvoiceLink,
  answerTelegramPreCheckoutQuery,
  setTelegramStarsClientForTests,
  resetTelegramStarsClient
};
