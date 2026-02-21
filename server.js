require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./database');
const leaderboardRoutes = require('./routes/leaderboard');

const app = express();

// ✅ CORS для Vercel
app.use(cors({
  origin: "*",
  credentials: false,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json());

// Подключаем БД
connectDB();

// Routes
app.use('/api/leaderboard', leaderboardRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date(),
    backend: 'ursass-backend',
    mongodb: 'connected'
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`✅ MongoDB подключена`);
  console.log(`🌐 CORS enabled for all origins`);
});
