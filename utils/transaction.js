const mongoose = require('mongoose');
const logger = require('./logger');

function isTransactionUnsupportedError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('transaction numbers are only allowed')
    || message.includes('replica set')
    || message.includes('not supported');
}

async function executeInTransaction(work) {
  const session = await mongoose.startSession();

  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (error) {
    if (isTransactionUnsupportedError(error)) {
      logger.warn({ err: error.message }, 'Transactions unsupported, falling back to non-transaction mode');
      return work(null);
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  executeInTransaction
};
