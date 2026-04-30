const logger = require('./logger');

const DEFAULT_TTL_MS = Math.max(1_000, Number(process.env.LEADERBOARD_TOP_CACHE_TTL_MS || 30_000));
const CACHE_KEY = process.env.LEADERBOARD_TOP_CACHE_KEY || 'leaderboard:top:public:v1';

const memoryState = {
  value: null,
  expiresAt: 0,
  hits: 0,
  misses: 0
};

function isTestEnv() {
  return (process.env.NODE_ENV || '').toLowerCase() === 'test';
}

function getTtlMs() {
  return isTestEnv() ? 0 : DEFAULT_TTL_MS;
}

function hasRedisRestConfig() {
  return Boolean(process.env.REDIS_REST_URL && process.env.REDIS_REST_TOKEN);
}

async function callRedisRest(command) {
  const url = `${process.env.REDIS_REST_URL.replace(/\/+$/, '')}/${command.join('/')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.REDIS_REST_TOKEN}` }
  });

  if (!res.ok) {
    throw new Error(`Redis REST error: HTTP ${res.status}`);
  }

  const body = await res.json();
  if (body.error) {
    throw new Error(`Redis REST error: ${body.error}`);
  }
  return body.result;
}

async function getFromRedis() {
  const raw = await callRedisRest(['get', CACHE_KEY]);
  if (!raw) return null;
  const normalized = typeof raw === 'string' ? decodeURIComponent(raw) : raw;
  return JSON.parse(normalized);
}

async function setToRedis(payload, ttlSeconds) {
  await callRedisRest(['setex', CACHE_KEY, String(ttlSeconds), encodeURIComponent(JSON.stringify(payload))]);
}

async function delFromRedis() {
  await callRedisRest(['del', CACHE_KEY]);
}

async function getTopLeaderboardCache() {
  const ttlMs = getTtlMs();
  if (ttlMs <= 0) return null;

  if (hasRedisRestConfig()) {
    try {
      const cached = await getFromRedis();
      if (cached) memoryState.hits += 1;
      else memoryState.misses += 1;
      return cached;
    } catch (error) {
      logger.warn({ err: error.message }, 'Redis cache read failed, falling back to memory cache');
    }
  }

  if (memoryState.value && memoryState.expiresAt > Date.now()) {
    memoryState.hits += 1;
    return memoryState.value;
  }
  memoryState.misses += 1;
  return null;
}

async function setTopLeaderboardCache(payload) {
  const ttlMs = getTtlMs();
  if (ttlMs <= 0) return;

  memoryState.value = payload;
  memoryState.expiresAt = Date.now() + ttlMs;

  if (hasRedisRestConfig()) {
    try {
      await setToRedis(payload, Math.ceil(ttlMs / 1000));
    } catch (error) {
      logger.warn({ err: error.message }, 'Redis cache write failed, memory cache retained');
    }
  }
}

async function invalidateTopLeaderboardCache(reason = 'unknown') {
  memoryState.value = null;
  memoryState.expiresAt = 0;

  if (hasRedisRestConfig()) {
    try {
      await delFromRedis();
    } catch (error) {
      logger.warn({ err: error.message, reason }, 'Redis cache invalidation failed');
    }
  }

  logger.info({ reason }, 'Top leaderboard cache invalidated');
}

function getTopLeaderboardCacheStats() {
  return {
    hits: memoryState.hits,
    misses: memoryState.misses,
    ttlMs: getTtlMs(),
    backend: hasRedisRestConfig() ? 'redis_rest+memory_fallback' : 'memory'
  };
}

module.exports = {
  getTtlMs,
  getTopLeaderboardCache,
  setTopLeaderboardCache,
  invalidateTopLeaderboardCache,
  getTopLeaderboardCacheStats
};
