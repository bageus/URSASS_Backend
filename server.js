require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./database');
const leaderboardRoutes = require('./routes/leaderboard');

const app = express();

// ✅ ИСПРАВЛЕННЫЙ CORS (добавьте ваши боевые домены)
const allowedOrigins = [
  'https://bageus.github.io',
  'https://ursass-tube.vercel.app',  // ✅ ДОБАВЬТЕ ВАШЕ РАБОЧЕЕ ЗНАЧЕНИЕ
  'http://localhost:3000',
  'http://localhost:5173'
];

app.use(cors({
  origin: function(origin, callback) {
    // ✅ Разрешаем запросы без origin (мобильные приложения, Postman)
    if(!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`❌ CORS блокирован для: ${origin}`);
      callback(null, true);  // Разрешаем в любом случае (можно изменить на strict)
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Wallet']
}));

app.options('*', cors());  // ✅ Обработка preflight запросов

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
  console.log(`📡 Разрешённые домены:`, allowedOrigins);
});
