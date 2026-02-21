const mongoose = require('mongoose');

async function connectDB() {
  try {
    const mongoUri = process.env.MONGO_URL;
    
    if(!mongoUri) {
      console.error('❌ MONGO_URL не найдена');
      process.exit(1);
    }
    
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000
    });
    
    console.log('✅ MongoDB подключена');
  } catch(error) {
    console.error('❌ Ошибка MongoDB:', error.message);
    setTimeout(() => connectDB(), 5000);
  }
}

module.exports = connectDB;
