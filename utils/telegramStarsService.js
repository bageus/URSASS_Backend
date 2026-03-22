const logger = require('./logger');

function createTelegramStarsError(message, options = {}) {
  const error = new Error(message);
  error.statusCode = options.statusCode || 500;
  error.code = options.code || 'telegram_stars_error';
  error.details = options.details || null;
  error.expose = options.expose !== false;
  return error;
}

function getTelegramBotToken() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    throw createTelegramStarsError('Telegram Stars payments are not configured: TELEGRAM_BOT_TOKEN is missing.', {
      statusCode: 503,
      code: 'telegram_stars_not_configured'
    });
  }

  if (!/^\d{3,}:[A-Za-z0-9_-]{5,}$/.test(token)) {
    throw createTelegramStarsError('Telegram Stars payments are not configured correctly: TELEGRAM_BOT_TOKEN format is invalid.', {
      statusCode: 503,
      code: 'telegram_stars_invalid_bot_token'
    });
  }

  return token;
}

function classifyTelegramApiError(responseStatus, description, operation) {
  const normalized = String(description || '').toLowerCase();
  const details = {
    operation,
    responseStatus: responseStatus || null,
    description: description || null
  };

  if (responseStatus === 401 || normalized.includes('unauthorized') || normalized.includes('bot token')) {
    return createTelegramStarsError('Telegram Stars payments are unavailable: the bot token is invalid or rejected by Telegram.', {
      statusCode: 503,
      code: 'telegram_stars_invalid_bot_token',
      details
    });
  }

  if (
    normalized.includes('payment')
    || normalized.includes('invoice')
    || normalized.includes('provider')
    || normalized.includes('currency')
    || normalized.includes('xtr')
    || normalized.includes('stars')
  ) {
    return createTelegramStarsError(`Telegram Stars invoice creation failed: ${description || 'Telegram rejected the invoice request.'}`, {
      statusCode: 502,
      code: 'telegram_stars_upstream_rejected',
      details
    });
  }

  return createTelegramStarsError(`Telegram API request failed during ${operation}: ${description || 'Unknown Telegram error.'}`, {
    statusCode: 502,
    code: 'telegram_api_error',
    details
  });
}

async function parseTelegramResponse(response, operation) {
  const contentType = response.headers.get('content-type') || '';

  try {
    if (contentType.includes('application/json')) {
      return await response.json();
    }

    const text = await response.text();
    return { ok: false, description: text || `Telegram returned non-JSON response for ${operation}` };
  } catch (error) {
    logger.error({ err: error, operation }, 'Failed to parse Telegram Bot API response');
    throw createTelegramStarsError(`Telegram API returned an unreadable response during ${operation}.`, {
      statusCode: 502,
      code: 'telegram_api_invalid_response'
    });
  }
}

let telegramStarsClient = {
  async createInvoiceLink(payload) {
    const token = getTelegramBotToken();

    let response;
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/createInvoiceLink`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      logger.error({ err: error }, 'Telegram createInvoiceLink network failure');
      throw createTelegramStarsError('Telegram Stars invoice service is temporarily unavailable.', {
        statusCode: 502,
        code: 'telegram_stars_network_error'
      });
    }

    const data = await parseTelegramResponse(response, 'createInvoiceLink');
    if (!response.ok || !data.ok || !data.result) {
      logger.error({ status: response.status, response: data, payload }, 'Telegram createInvoiceLink failed');
      throw classifyTelegramApiError(response.status, data.description, 'createInvoiceLink');
    }

    return data.result;
  },

  async answerPreCheckoutQuery(preCheckoutQueryId, ok, errorMessage = undefined) {
    const token = getTelegramBotToken();

    let response;
    try {
      response = await fetch(`https://api.telegram.org/bot${token}/answerPreCheckoutQuery`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          pre_checkout_query_id: preCheckoutQueryId,
          ok,
          ...(ok ? {} : { error_message: errorMessage || 'Payment validation failed' })
        })
      });
    } catch (error) {
      logger.error({ err: error, preCheckoutQueryId, ok }, 'Telegram answerPreCheckoutQuery network failure');
      throw createTelegramStarsError('Telegram payment validation service is temporarily unavailable.', {
        statusCode: 502,
        code: 'telegram_stars_network_error'
      });
    }

    const data = await parseTelegramResponse(response, 'answerPreCheckoutQuery');
    if (!response.ok || !data.ok) {
      logger.error({ status: response.status, response: data, preCheckoutQueryId, ok }, 'Telegram answerPreCheckoutQuery failed');
      throw classifyTelegramApiError(response.status, data.description, 'answerPreCheckoutQuery');
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
  resetTelegramStarsClient,
  getTelegramBotToken,
  createTelegramStarsError
};
