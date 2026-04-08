require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../database');
const { createApp } = require('../app');
const logger = require('../utils/logger');

const app = createApp();
let dbConnectPromise = null;

async function ensureDatabaseConnection() {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  if (!dbConnectPromise) {
    dbConnectPromise = connectDB().catch((error) => {
      dbConnectPromise = null;
      throw error;
    });
  }

  await dbConnectPromise;
}

module.exports = async (req, res) => {
  try {
    await ensureDatabaseConnection();
    app(req, res);
  } catch (error) {
    logger.error({ err: error.message }, 'Failed to initialize API handler on Vercel');
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Service initialization failed' }));
  }
};
