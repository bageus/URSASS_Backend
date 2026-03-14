require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./database');
const leaderboardRoutes = require('./routes/leaderboard');
const storeRoutes = require('./routes/store');
const accountRoutes = require('./routes/account');
const { initBot } = require('./bot');
const logger = require('./utils/logger');
const mongoose = require('mongoose');
const { createCorsOriginValidator } = require('./utils/corsConfig');
const { metricsMiddleware, renderMetricsText } = require('./middleware/requestMetrics');

const app = express();

const trustProxyValue = process.env.TRUST_PROXY;
if (trustProxyValue === 'true') {
  app.set('trust proxy', true);
} else if (trustProxyValue === 'false' || !trustProxyValue) {
  app.set('trust proxy', false);
} else {
  app.set('trust proxy', trustProxyValue);
}

function isLoopbackOrPrivate(ip = '') {
  const normalized = String(ip).replace(/^::ffff:/, '');
  if (!normalized) {
    return false;
  }

  if (normalized === '::1' || normalized === '127.0.0.1') {
    return true;
  }

  return normalized.startsWith('10.')
    || normalized.startsWith('192.168.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized);
}

const isAllowedOrigin = createCorsOriginValidator(process.env);

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (isAllowedOrigin(origin)) {
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

const runBotInProcess = process.env.BOT_MODE !== 'worker' && process.env.START_BOT_IN_PROCESS !== 'false';

// Connect DB then optionally start bot in the same process
connectDB()
  .then(() => {
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

// Routes
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/account', accountRoutes);

// Versioned aliases (safe migration path)
app.use('/api/v1/leaderboard', leaderboardRoutes);
app.use('/api/v1/store', storeRoutes);
app.use('/api/v1/account', accountRoutes);

// Health
app.get('/health', (req, res) => {
  const stateMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  const mongoState = stateMap[mongoose.connection.readyState] || 'unknown';
  const isReady = mongoState === 'connected';

  res.status(isReady ? 200 : 503).json({
    status: isReady ? 'OK' : 'DEGRADED',
    timestamp: new Date(),
    mongodb: mongoState
  });
});

app.get('/metrics', async (req, res) => {
  const metricsToken = process.env.METRICS_TOKEN;
  const authHeader = req.get('authorization') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const headerToken = req.get('x-metrics-token');

  const hasValidToken = metricsToken
    ? bearerToken === metricsToken || headerToken === metricsToken
    : false;

  if (!hasValidToken && !isLoopbackOrPrivate(req.ip)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  const metricsText = await renderMetricsText();
  res.end(metricsText);
});

// Error handler
app.use((err, req, res, next) => {
  logger.error({ err }, 'Unhandled error');
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  logger.info({ port: PORT }, 'Server started');
});
