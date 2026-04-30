const test = require('node:test');
const assert = require('node:assert/strict');

const cachePath = require.resolve('../utils/leaderboardTopCache');

function loadCacheWithEnv(envPatch = {}) {
  const prev = {};
  for (const [k, v] of Object.entries(envPatch)) {
    prev[k] = process.env[k];
    if (v === null) delete process.env[k];
    else process.env[k] = String(v);
  }

  delete require.cache[cachePath];
  const mod = require('../utils/leaderboardTopCache');

  return {
    mod,
    restore() {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      delete require.cache[cachePath];
    }
  };
}

test('leaderboard cache disabled in test env', async () => {
  const { mod, restore } = loadCacheWithEnv({ NODE_ENV: 'test' });
  try {
    assert.equal(mod.getTtlMs(), 0);
    await mod.setTopLeaderboardCache({ hello: 1 });
    const cached = await mod.getTopLeaderboardCache();
    assert.equal(cached, null);
  } finally {
    restore();
  }
});

test('leaderboard cache uses memory fallback when redis is not configured', async () => {
  const { mod, restore } = loadCacheWithEnv({
    NODE_ENV: 'development',
    REDIS_REST_URL: null,
    REDIS_REST_TOKEN: null,
    LEADERBOARD_TOP_CACHE_TTL_MS: 60000
  });

  try {
    await mod.invalidateTopLeaderboardCache('unit_test_reset');
    await mod.setTopLeaderboardCache({ ok: true });
    const cached = await mod.getTopLeaderboardCache();
    assert.deepEqual(cached, { ok: true });

    const stats = mod.getTopLeaderboardCacheStats();
    assert.equal(stats.backend, 'memory');
    assert.equal(stats.hits > 0, true);
  } finally {
    restore();
  }
});
