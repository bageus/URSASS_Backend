const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const leaderboardRoutes = require('./routes/leaderboard');
const storeRoutes = require('./routes/store');
const accountRoutes = require('./routes/account');
const gameRoutes = require('./routes/game');
const donationsRoutes = require('./routes/donations');
const logger = require('./utils/logger');
const { metricsMiddleware, renderMetricsText } = require('./middleware/requestMetrics');

function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  const extraAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const allowedOrigins = [
    'https://bageus.github.io',
    'https://ursass-tube.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    ...extraAllowedOrigins
  ];

  const corsOptions = {
    origin: function(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }


      logger.warn({ origin }, 'CORS blocked');
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Wallet', 'X-Primary-Id', 'X-Telegram-Init-Data', 'x-telegram-init-data']
  };

  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));
  app.use(express.json({ limit: '1mb' }));
  app.use(metricsMiddleware);

  app.use('/api/leaderboard', leaderboardRoutes);
  app.use('/api/store', storeRoutes);
  app.use('/api/account', accountRoutes);
  app.use('/api/game', gameRoutes);
  app.use('/api', donationsRoutes);

  app.use('/api/v1/leaderboard', leaderboardRoutes);
  app.use('/api/v1/store', storeRoutes);
  app.use('/api/v1/account', accountRoutes);
  app.use('/api/v1/game', gameRoutes);
  app.use('/api/v1', donationsRoutes);

  app.get('/health', (req, res) => {
    const mongoStates = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };
    const readyState = mongoose.connection?.readyState;
    const mongoStatus = mongoStates[readyState] || 'unknown';

    res.json({
      status: readyState === 1 ? 'OK' : 'DEGRADED',
      timestamp: new Date(),
      mongodb: mongoStatus,
      mongodbDetails: {
        readyState,
        status: mongoStatus
      }
    });
  });

  app.get('/metrics', (req, res) => {
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.end(renderMetricsText());
  });

  app.use((err, req, res, next) => {
    logger.error({ err }, 'Unhandled error');
    const statusCode = err.statusCode || err.status || 500;
    const shouldExposeMessage = Boolean(err.expose) || statusCode < 500;
    res
      .status(statusCode)
      .json({ error: shouldExposeMessage ? (err.message || 'Request failed') : 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
