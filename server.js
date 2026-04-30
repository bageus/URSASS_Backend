require('dotenv').config();
const connectDB = require('./database');
const { initBot } = require('./bot');
const logger = require('./utils/logger');
const { createApp } = require('./app');
const { startDonationPaymentRecheckLoop } = require('./utils/donationService');
const { validateStartupConfig } = require('./utils/startupConfig');
const { startLeaderboardAggregateRefreshLoop } = require('./services/leaderboardAggregateRefreshService');

const app = createApp();


const startupValidation = validateStartupConfig();
startupValidation.warnings.forEach((warning) => {
  logger.warn({ warning }, 'Startup configuration warning');
});

if (startupValidation.errors.length > 0) {
  startupValidation.errors.forEach((error) => {
    logger.error({ error }, 'Startup configuration error');
  });
  process.exit(1);
}

const runBotInProcess = process.env.BOT_MODE !== 'worker' && process.env.START_BOT_IN_PROCESS !== 'false';

// Connect DB then optionally start bot in the same process
connectDB()
  .then(() => {
    startDonationPaymentRecheckLoop();
    startLeaderboardAggregateRefreshLoop();

    if (!runBotInProcess) {
      logger.info('BOT_MODE=worker (or START_BOT_IN_PROCESS=false): skipping bot in API process');
      return;
    }

    logger.info('Starting Telegram bot in API process...');
    initBot();
  })
  .catch((err) => {
    logger.error({ err: err.message }, 'DB connection failed, bot not started');
  });

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT }, 'Server started');
});
