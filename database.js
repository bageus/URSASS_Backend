const mongoose = require('mongoose');

async function connectDB() {
  try {
    // ✅ Railway автоматически созд��ёт MONGODB_URI
    const mongoUri = process.env.MONGODB_URI || process.env.DATABASE_URL;
    
    if(!mongoUri) {
      console.error('❌ MONGODB_URI не найдена в переменных окружения');
      process.exit(1);
    }
    
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000
    });
    
    console.log('✅ MongoDB подключена на Railway');
  } catch(error) {
    console.error('❌ Ошибка подключения MongoDB:', error.message);
    setTimeout(() => connectDB(), 5000);  // Retry через 5 сек
  }
}

module.exports = connectDB;
