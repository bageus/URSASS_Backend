const crypto = require('crypto');
const AuthChallenge = require('../models/AuthChallenge');

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function issueAuthChallenge({ type, primaryId = null, telegramId = null, ttlMs = 2 * 60 * 1000 }) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + ttlMs);

  await AuthChallenge.create({
    tokenHash,
    type,
    primaryId: primaryId ? String(primaryId).toLowerCase() : null,
    telegramId: telegramId ? String(telegramId) : null,
    expiresAt,
    used: false
  });

  return {
    token,
    expiresInSeconds: Math.floor(ttlMs / 1000)
  };
}

async function consumeAuthChallenge({ token, type, primaryId = null, telegramId = null }) {
  const tokenHash = hashToken(token);
  const now = new Date();

  const filter = {
    tokenHash,
    type,
    used: false,
    expiresAt: { $gt: now }
  };

  if (primaryId !== null) {
    filter.primaryId = String(primaryId).toLowerCase();
  }

  if (telegramId !== null) {
    filter.telegramId = String(telegramId);
  }

  const challenge = await AuthChallenge.findOneAndUpdate(
    filter,
    { $set: { used: true, usedAt: now } },
    { new: true }
  );

  return Boolean(challenge);
}

module.exports = {
  issueAuthChallenge,
  consumeAuthChallenge
};
