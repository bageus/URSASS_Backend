const mongoose = require('mongoose');

function requireMongoReady(req, res, next) {
  if ((process.env.NODE_ENV || '').toLowerCase() === 'test' && process.env.ENFORCE_MONGO_READINESS !== 'true') {
    return next();
  }

  if (mongoose.connection?.readyState === 1) return next();

  return res.status(503).json({
    error: 'database_unavailable',
    message: 'Database is not ready. Please retry shortly.',
    mongodb: {
      readyState: mongoose.connection?.readyState ?? null
    }
  });
}

module.exports = { requireMongoReady };
