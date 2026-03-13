require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./database');
const leaderboardRoutes = require('./routes/leaderboard');
const storeRoutes = require('./routes/store');
const accountRoutes = require('./routes/account');
const { initBot } = require('./bot');
const logger = require('./utils/logger');
const { metricsMiddleware, renderMetricsText } = require('./middleware/requestMetrics');

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
  res.json({ status: 'OK', timestamp: new Date(), mongodb: 'connected' });
});

app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.end(renderMetricsText());
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
