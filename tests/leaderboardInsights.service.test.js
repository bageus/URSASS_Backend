const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../models/Player');
const PlayerRun = require('../models/PlayerRun');
const {
  computePlayerInsights,
  pickComparisonMode,
  pickRecommendedTarget,
  computePercentileFromRank
} = require('../services/leaderboardInsightsService');

function mockRankedScores(scores) {
  Player.countDocuments = async (query = {}) => {
    if (!query.bestScore || !query.bestScore.$gt) return scores.length;
    return scores.filter((score) => score > query.bestScore.$gt).length;
  };

  Player.find = () => ({
    sort() { return this; },
    skip(idx) {
      this._idx = idx;
      return this;
    },
    limit() { return this; },
    select() {
      const score = scores[this._idx];
      return Promise.resolve(score ? [{ bestScore: score }] : []);
    }
  });
}

test('computePercentileFromRank handles edge-cases', () => {
  assert.equal(computePercentileFromRank(null, 100), null);
  assert.equal(computePercentileFromRank(1, 1), null);
  assert.equal(computePercentileFromRank(1, 101), 100);
  assert.equal(computePercentileFromRank(101, 101), 0);
});

test('pickComparisonMode returns none when segment is too small', () => {
  const mode = pickComparisonMode({
    percentileFirstRunScore: 50,
    firstRunScoreSample: 3,
    percentileFirstRunDistance: 10,
    firstRunDistanceSample: 3,
    percentileFirstRunCoins: 90,
    firstRunCoinsSample: 3
  }, { minimumSegmentSize: 10 });

  assert.equal(mode, 'none');
});

test('computePlayerInsights: first run + personal best + top10 segment', async () => {
  mockRankedScores([12000, 10000, 9000, 8500, 8000, 7700, 7400, 7100, 7000, 6800, 6000]);

  PlayerRun.findOne = () => ({
    sort: async () => ({ isFirstRun: true, isPersonalBest: true, score: 7000, distance: 300, goldCoins: 10 })
  });

  PlayerRun.countDocuments = async (query = {}) => {
    if (query.isFirstRun && query.score && query.score.$gt !== undefined) return 3;
    if (query.isFirstRun && query.distance && query.distance.$gt !== undefined) return 4;
    if (query.isFirstRun && query.goldCoins && query.goldCoins.$gt !== undefined) return 2;
    if (query.isFirstRun) return 100;
    return 100;
  };

  const insights = await computePlayerInsights({
    wallet: '0xabc',
    player: { bestScore: 7000 },
    config: {
    minimumSegmentSize: 10,
    weakPercentileThreshold: 10,
    realisticDeltaTop10: 2000,
    realisticDeltaTop100: 3000,
    realisticDeltaTop1000: 4000,
    realisticDeltaTop10000: 5000,
      insightsEnabled: true
    }
  });

  assert.equal(insights.isFirstRun, true);
  assert.equal(insights.isPersonalBest, true);
  assert.equal(insights.rank, 9);
  assert.equal(insights.enteredTop10, true);
  assert.equal(insights.comparisonMode, 'first_run_coins');
  assert.ok(insights.recommendedTarget);
});

test('computePlayerInsights: repeat run with weak percentile fallback', async () => {
  mockRankedScores([5000, 4500, 4300, 4100, 3900, 3700, 3500, 3300, 3000, 2800, 2500, 2200]);

  PlayerRun.findOne = () => ({
    sort: async () => ({ isFirstRun: false, isPersonalBest: false, score: 2200, distance: 80, goldCoins: 1 })
  });

  PlayerRun.countDocuments = async (query = {}) => {
    if (query.isFirstRun && query.score && query.score.$gt !== undefined) return 94;
    if (query.isFirstRun && query.distance && query.distance.$gt !== undefined) return 95;
    if (query.isFirstRun && query.goldCoins && query.goldCoins.$gt !== undefined) return 98;
    if (query.isFirstRun) return 100;
    return 100;
  };

  const insights = await computePlayerInsights({
    wallet: '0xabc',
    player: { bestScore: 2200 },
    config: {
    minimumSegmentSize: 10,
    weakPercentileThreshold: 25,
    realisticDeltaTop10: 200,
    realisticDeltaTop100: 400,
    realisticDeltaTop1000: 900,
    realisticDeltaTop10000: 3000,
      insightsEnabled: true
    }
  });

  assert.equal(insights.comparisonTextFallbackType, 'weak_repeat_run');
  assert.equal(insights.isFirstRun, false);
});

test('recommended target supports top100/top1000/top10000 buckets', () => {
  const top100 = pickRecommendedTarget([
    { targetType: 'rank', targetRank: 10, delta: 1500 },
    { targetType: 'rank', targetRank: 50, delta: 300 }
  ], 80, { realisticDeltaTop100: 400 });
  assert.equal(top100.label, 'TOP 50');

  const top1000 = pickRecommendedTarget([
    { targetType: 'rank', targetRank: 100, delta: 900 },
    { targetType: 'bucket', bucket: 'top100', delta: Number.MAX_SAFE_INTEGER }
  ], 600, { realisticDeltaTop1000: 1000 });
  assert.equal(top1000.label, 'TOP 100');

  const top10000 = pickRecommendedTarget([
    { targetType: 'rank', targetRank: 1000, delta: 1200 }
  ], 9000, { realisticDeltaTop10000: 1300 });
  assert.equal(top10000.label, 'TOP 1000');
});

test('computePlayerInsights ignores invalid statistical segment data', async () => {
  mockRankedScores([100]);

  PlayerRun.findOne = () => ({
    sort: async () => ({ isFirstRun: false, isPersonalBest: true, score: 100, distance: 10, goldCoins: 0 })
  });

  PlayerRun.countDocuments = async (query = {}) => {
    if (query.score || query.distance || query.goldCoins) return 0;
    return 1;
  };

  const insights = await computePlayerInsights({
    wallet: '0xabc',
    player: { bestScore: 100 },
    config: { insightsEnabled: true, minimumSegmentSize: 10, weakPercentileThreshold: 20 }
  });

  assert.equal(insights.comparisonMode, 'none');
  assert.equal(insights.percentileOverall, null);
});
