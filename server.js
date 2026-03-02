require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./database');
const leaderboardRoutes = require('./routes/leaderboard');
const storeRoutes = require('./routes/store');
const accountRoutes = require('./routes/account');
const { initBot } = require('./bot');

const app = express();

app.set('trust proxy', 1);

const allowedOrigins = [
  'https://bageus.github.io',
  'https://ursass-tube.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173'
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

    console.warn(`❌ CORS blocked: ${origin}`);
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Wallet', 'X-Primary-Id']
}));

app.options('*', cors());
app.use(express.json({ limit: '1mb' }));

// Connect DB then start bot
connectDB()
  .then(() => {
    console.log('🤖 Starting Telegram bot...');
    initBot();
  })
  .catch((err) => {
    console.error('❌ DB connection failed, bot not started:', err.message);
  });

// Routes
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/account', accountRoutes);

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date(), mongodb: 'connected' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
