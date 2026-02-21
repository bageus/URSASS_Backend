const mongoose = require('mongoose');

async function connectDB() {
  try {
    // ✅ Railway MongoDB использует MONGO_URL
    const mongoUri = process.env.MONGO_URL;
    
    console.log(`🔍 Ищу MONGO_URL...`);
    
    if(!mongoUri) {
      console.error('❌ MONGO_URL не найдена в переменных окружения');
      process.exit(1);
    }
    
    console.log(`✅ Подключаюсь к MongoDB...`);
    console.log(`URL: ${mongoUri.substring(0, 50)}...`);
    
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000
    });
    
    console.log('✅ MongoDB подключена успешно!');
  } catch(error) {
    console.error('❌ Ошибка подключения MongoDB:', error.message);
    setTimeout(() => connectDB(), 5000);
  }
}

module.exports = connectDB;
