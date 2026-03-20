require('dotenv').config();
const connectDB = require('./database');
const { initBot } = require('./bot');
const logger = require('./utils/logger');
const { createApp } = require('./app');
const { startDonationPaymentRecheckLoop } = require('./utils/donationService');

const app = createApp();

const runBotInProcess = process.env.BOT_MODE !== 'worker' && process.env.START_BOT_IN_PROCESS !== 'false';

// Connect DB then optionally start bot in the same process
connectDB()
  .then(() => {
    startDonationPaymentRecheckLoop();

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
