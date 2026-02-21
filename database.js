const mongoose = require('mongoose');

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB подключена');
  } catch(error) {
    console.error('❌ Ошибка подключения MongoDB:', error);
    process.exit(1);
  }
}

module.exports = connectDB;