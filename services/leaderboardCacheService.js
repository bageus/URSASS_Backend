const logger = require('../utils/logger');

const MEMORY = new Map();
const UPSTASH_URL = (process.env.UPSTASH_REDIS_REST_URL || '').trim();
const UPSTASH_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();

const cacheStats = {
  hits: 0,
  misses: 0,
  backend: UPSTASH_URL && UPSTASH_TOKEN ? 'upstash' : 'memory'
};
const IS_TEST_ENV = (process.env.NODE_ENV || '').toLowerCase() === 'test';

function toKey(key) {
  return `leaderboard:${String(key || '').trim()}`;
}

function getStats() {
  return { ...cacheStats };
}

async function getFromUpstash(cacheKey) {
  const response = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(cacheKey)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });

  if (!response.ok) {
    throw new Error(`upstash_get_failed_${response.status}`);
  }

  const body = await response.json();
  if (!body?.result) {
    return null;
  }

  return JSON.parse(body.result);
}

async function setToUpstash(cacheKey, value, ttlSeconds) {
  const response = await fetch(`${UPSTASH_URL}/set/${encodeURIComponent(cacheKey)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ value: JSON.stringify(value), ex: ttlSeconds })
  });

  if (!response.ok) {
    throw new Error(`upstash_set_failed_${response.status}`);
  }
}

async function delFromUpstash(cacheKey) {
  const response = await fetch(`${UPSTASH_URL}/del/${encodeURIComponent(cacheKey)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });

  if (!response.ok) {
    throw new Error(`upstash_del_failed_${response.status}`);
  }
}

async function getLeaderboardCache(key) {
  if (IS_TEST_ENV) {
    cacheStats.misses += 1;
    return null;
  }
  const cacheKey = toKey(key);

  try {
    if (cacheStats.backend === 'upstash') {
      const value = await getFromUpstash(cacheKey);
      if (value) cacheStats.hits += 1;
      else cacheStats.misses += 1;
      return value;
    }

    const entry = MEMORY.get(cacheKey);
    if (!entry || entry.expiresAt <= Date.now()) {
      MEMORY.delete(cacheKey);
      cacheStats.misses += 1;
      return null;
    }

    cacheStats.hits += 1;
    return entry.value;
  } catch (error) {
    logger.warn({ err: error.message, cacheKey }, 'Leaderboard cache get failed, fallback to miss');
    cacheStats.misses += 1;
    return null;
  }
}

async function setLeaderboardCache(key, value, ttlMs) {
  if (IS_TEST_ENV) {
    return;
  }
  const cacheKey = toKey(key);
  try {
    if (cacheStats.backend === 'upstash') {
      const ttlSeconds = Math.max(1, Math.ceil(ttlMs / 1000));
      await setToUpstash(cacheKey, value, ttlSeconds);
      return;
    }

    MEMORY.set(cacheKey, { value, expiresAt: Date.now() + ttlMs });
  } catch (error) {
    logger.warn({ err: error.message, cacheKey }, 'Leaderboard cache set failed');
  }
}

async function invalidateLeaderboardCache(keys = []) {
  if (IS_TEST_ENV) {
    MEMORY.clear();
    return;
  }
  const normalized = Array.from(new Set(keys.map(toKey)));

  for (const cacheKey of normalized) {
    try {
      if (cacheStats.backend === 'upstash') {
        await delFromUpstash(cacheKey);
      } else {
        MEMORY.delete(cacheKey);
      }
    } catch (error) {
      logger.warn({ err: error.message, cacheKey }, 'Leaderboard cache invalidation failed');
    }
  }
}

module.exports = { getLeaderboardCache, setLeaderboardCache, invalidateLeaderboardCache, getStats };
