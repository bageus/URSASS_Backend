const logger = require('../../utils/logger');

/**
 * @typedef {Object} TelegramAnalyticsConfig
 * @property {boolean} enabled
 * @property {string} token
 * @property {string} appName
 */

/** @returns {TelegramAnalyticsConfig} */
function readTelegramAnalyticsConfig(env = process.env) {
  return {
    enabled: String(env.TG_ANALYTICS_ENABLED || '').trim().toLowerCase() === 'true',
    token: String(env.TG_ANALYTICS_TOKEN || ''),
    appName: String(env.TG_ANALYTICS_APP_NAME || 'ursass_tube')
  };
}

/**
 * @returns {TelegramAnalyticsConfig}
 */
function getPublicTelegramAnalyticsConfig(env = process.env) {
  const config = readTelegramAnalyticsConfig(env);

  if (config.enabled && !config.token.trim()) {
    logger.warn('[Analytics] TG_ANALYTICS_ENABLED=true but TG_ANALYTICS_TOKEN is missing');
    return {
      ...config,
      enabled: false
    };
  }

  return config;
}

module.exports = {
  readTelegramAnalyticsConfig,
  getPublicTelegramAnalyticsConfig
};
