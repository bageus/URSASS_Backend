function format(level, message, meta = {}) {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    service: 'ursass-backend',
    env: process.env.NODE_ENV || 'development',
    ...meta
  });
}

module.exports = {
  info(meta, message) {
    if (typeof meta === 'string') {
      console.log(format('info', meta));
      return;
    }
    console.log(format('info', message || 'info', meta || {}));
  },
  warn(meta, message) {
    if (typeof meta === 'string') {
      console.warn(format('warn', meta));
      return;
    }
    console.warn(format('warn', message || 'warn', meta || {}));
  },
  error(meta, message) {
    if (typeof meta === 'string') {
      console.error(format('error', meta));
      return;
    }
    console.error(format('error', message || 'error', meta || {}));
  }
};
