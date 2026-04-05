const REPLAY_TTL_MS = Math.max(60 * 1000, Number(process.env.TELEGRAM_WEBHOOK_REPLAY_TTL_MS || 10 * 60 * 1000));
const seenUpdates = new Map();

function cleanupSeenUpdates(now = Date.now()) {
  for (const [key, expiresAt] of seenUpdates.entries()) {
    if (expiresAt <= now) {
      seenUpdates.delete(key);
    }
  }
}

function rememberTelegramUpdate(updateId, now = Date.now()) {
  if (updateId == null) {
    return false;
  }

  cleanupSeenUpdates(now);
  const key = String(updateId);
  const existingExpiry = seenUpdates.get(key);
  if (existingExpiry && existingExpiry > now) {
    return true;
  }

  seenUpdates.set(key, now + REPLAY_TTL_MS);
  return false;
}

function resetTelegramWebhookReplayStore() {
  seenUpdates.clear();
}

module.exports = {
  rememberTelegramUpdate,
  resetTelegramWebhookReplayStore
};
