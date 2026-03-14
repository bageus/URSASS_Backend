const mongoose = require('mongoose');

async function connectDB() {
  try {
    const mongoUri = process.env.MONGO_URL;
    
    if(!mongoUri) {
      throw new Error('MONGO_URL is missing');
    }
    
    await mongoose.connect(mongoUri, {
      connectTimeoutMS: 10000,
      serverSelectionTimeoutMS: 10000
    });
    
    console.log('✅ MongoDB подключена');
  } catch(error) {
    console.error('❌ Ошибка MongoDB:', error.message);

    if (!process.env.MONGO_URL) {
      throw error;
    }

    setTimeout(() => connectDB(), 5000);
    throw error;
  }
}

module.exports = connectDB;
