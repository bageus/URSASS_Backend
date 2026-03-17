const express = require('express');
const cors = require('cors');
const leaderboardRoutes = require('./routes/leaderboard');
const storeRoutes = require('./routes/store');
const accountRoutes = require('./routes/account');
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

  app.use(cors({
    origin: function(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      if (origin.endsWith('.vercel.app')) {
        callback(null, true);
        return;
      }

      logger.warn({ origin }, 'CORS blocked');
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Wallet', 'X-Primary-Id']
  }));

  app.options('*', cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(metricsMiddleware);

  app.use('/api/leaderboard', leaderboardRoutes);
  app.use('/api/store', storeRoutes);
  app.use('/api/account', accountRoutes);

  app.use('/api/v1/leaderboard', leaderboardRoutes);
  app.use('/api/v1/store', storeRoutes);
  app.use('/api/v1/account', accountRoutes);

  app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date(), mongodb: 'connected' });
  });

  app.get('/metrics', (req, res) => {
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.end(renderMetricsText());
  });

  app.use((err, req, res, next) => {
    logger.error({ err }, 'Unhandled error');
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
