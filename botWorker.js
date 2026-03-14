require('dotenv').config();
const connectDB = require('./database');
const { initBot } = require('./bot');

async function startWorker() {
  try {
    await connectDB();
    console.log('🤖 Bot worker connected to DB');
    initBot();
  } catch (error) {
    console.error('❌ Bot worker failed to start:', error.message || error);
    process.exit(1);
  }
}

startWorker();
