const mongoose = require('mongoose');
const logger = require('./utils/logger');

const RETRY_DELAY_MS = Number(process.env.MONGO_RETRY_DELAY_MS || 5000);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectDB() {
  const mongoUri = process.env.MONGO_URL;

  if (!mongoUri) {
    throw new Error('MONGO_URL is missing');
  }

  let attempt = 0;
  while (true) {
    attempt += 1;

    try {
      logger.info({ attempt }, 'MongoDB connect attempt');
      await mongoose.connect(mongoUri, {
        connectTimeoutMS: 10000,
        serverSelectionTimeoutMS: 10000
      });
      logger.info({ attempt }, 'MongoDB connected');
      return mongoose.connection;
    } catch (error) {
      logger.error({ err: error.message, attempt, retryInMs: RETRY_DELAY_MS }, 'MongoDB connection failed, retrying');
      await delay(RETRY_DELAY_MS);
    }
  }
}

module.exports = connectDB;
