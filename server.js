require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./database');
const leaderboardRoutes = require('./routes/leaderboard');

const app = express();

// ✅ CORS и JSON парсинг
app.use(cors({
  origin: ['https://bageus.github.io', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));

// ✅ Подключаемся к БД
connectDB();

// ✅ Routes
app.use('/api/leaderboard', leaderboardRoutes);

// ✅ Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date(),
    mongodb: 'connected'
  });
});

// ✅ Error handler (обязательно последний!)
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(err.status || 500).json({ 
    error: err.message || 'Internal server error' 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`📡 Backend URL: http://localhost:${PORT}`);
});
