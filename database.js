const mongoose = require('mongoose');
const logger = require('./utils/logger');

async function connectDB() {
  try {
    const mongoUri = process.env.MONGO_URL;
    
    if(!mongoUri) {
      throw new Error('MONGO_URL is missing');
    }
    
    await mongoose.connect(mongoUri, {
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000
    });
    
    logger.info('MongoDB connected');
  } catch(error) {
    logger.error({ err: error.message }, 'MongoDB connection error');

    if (!process.env.MONGO_URL) {
      throw error;
    }

    setTimeout(() => connectDB(), 5000);
    throw error;
  }
}

module.exports = connectDB;
