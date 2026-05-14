require('dotenv').config();
const connectDB = require('./database');
const { initBot } = require('./bot');

async function startWorker() {
  try {
    await connectDB();
    console.log('🤖 Bot worker connected to DB');

    const isTelegramBotEnabled = String(process.env.ENABLE_TELEGRAM_BOT || '').toLowerCase() === 'true';
    if (!isTelegramBotEnabled) {
      console.log('Telegram bot polling skipped because ENABLE_TELEGRAM_BOT is not true');
      return;
    }

    initBot();
  } catch (error) {
    console.error('❌ Bot worker failed to start:', error.message || error);
    process.exit(1);
  }
}

startWorker();
