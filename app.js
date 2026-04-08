const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const crypto = require('crypto');
const leaderboardRoutes = require('./routes/leaderboard');
const storeRoutes = require('./routes/store');
const accountRoutes = require('./routes/account');
const gameRoutes = require('./routes/game');
const donationsRoutes = require('./routes/donations');
const analyticsRoutes = require('./routes/analytics');
const logger = require('./utils/logger');
const { metricsMiddleware, renderMetricsText } = require('./middleware/requestMetrics');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const extraAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const allowedOrigins = [
    'https://bageus.github.io',
    'https://bageus-github-io.vercel.app',
    'https://ursass-tube.vercel.app',
    'http://localhost:3000',
    'http://localhost:5173',
    ...extraAllowedOrigins
  ];

  const allowedOriginSet = new Set(allowedOrigins);

  const isAllowedOrigin = (origin) => !origin || allowedOriginSet.has(origin);

  app.use((req, res, next) => {
    const requestId = req.get('x-request-id') || crypto.randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });

  const corsOptions = {
    origin: function(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }

      logger.warn({ origin }, 'CORS blocked: origin mismatch');
      const corsError = new Error('Not allowed by CORS');
      corsError.statusCode = 403;
      corsError.expose = true;
      corsError.code = 'CORS_ORIGIN_MISMATCH';
      callback(corsError);
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Wallet', 'X-Primary-Id', 'X-Telegram-Init-Data', 'x-telegram-init-data', 'X-Request-Id'],
    optionsSuccessStatus: 204
  };

  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    next();
  });

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    if ((process.env.NODE_ENV || '').toLowerCase() === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(metricsMiddleware);

  app.use('/api/leaderboard', leaderboardRoutes);
  app.use('/api/store', storeRoutes);
  app.use('/api/account', accountRoutes);
  app.use('/api/game', gameRoutes);
  app.use('/api', donationsRoutes);
  app.use('/api/analytics', analyticsRoutes);

  app.use('/api/v1/leaderboard', leaderboardRoutes);
  app.use('/api/v1/store', storeRoutes);
  app.use('/api/v1/account', accountRoutes);
  app.use('/api/v1/game', gameRoutes);
  app.use('/api/v1', donationsRoutes);
  app.use('/api/v1/analytics', analyticsRoutes);

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

  app.get('/metrics', async (req, res, next) => {
    try {
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.end(await renderMetricsText());
    } catch (error) {
      next(error);
    }
  });

  app.use((err, req, res, next) => {
    const origin = req.get('origin');
    if (origin && isAllowedOrigin(origin) && !res.getHeader('Access-Control-Allow-Origin')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    const statusCode = err.statusCode || err.status || 500;
    const shouldExposeMessage = Boolean(err.expose) || statusCode < 500;
    const errorCode = err.code || 'UNHANDLED_ERROR';

    logger.error({
      requestId: req.requestId,
      statusCode,
      errorCode,
      origin,
      path: req.originalUrl,
      method: req.method,
      err: err.message
    }, 'Request failed');

    res
      .status(statusCode)
      .json({
        error: shouldExposeMessage ? (err.message || 'Request failed') : 'Internal server error',
        code: errorCode,
        requestId: req.requestId
      });
  });

  return app;
}

module.exports = { createApp };
