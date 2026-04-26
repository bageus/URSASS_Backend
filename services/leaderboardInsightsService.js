const Player = require('../models/Player');
const PlayerRun = require('../models/PlayerRun');

const DEFAULTS = {
  insightsEnabled: process.env.LEADERBOARD_INSIGHTS_ENABLED !== 'false',
  minimumSegmentSize: Number(process.env.LEADERBOARD_INSIGHTS_MIN_SEGMENT_SIZE || 30),
  weakPercentileThreshold: Number(process.env.LEADERBOARD_INSIGHTS_WEAK_PERCENTILE || 20),
  realisticDeltaTop10: Number(process.env.LEADERBOARD_INSIGHTS_MAX_DELTA_TOP10 || 1200),
  realisticDeltaTop100: Number(process.env.LEADERBOARD_INSIGHTS_MAX_DELTA_TOP100 || 2200),
  realisticDeltaTop1000: Number(process.env.LEADERBOARD_INSIGHTS_MAX_DELTA_TOP1000 || 3200),
  realisticDeltaTop10000: Number(process.env.LEADERBOARD_INSIGHTS_MAX_DELTA_TOP10000 || 4500)
};

async function computeRank(bestScore) {
  if (!bestScore || bestScore <= 0) {
    return { rank: null, totalRankedPlayers: await Player.countDocuments({ bestScore: { $gt: 0 } }) };
  }

  const better = await Player.countDocuments({ bestScore: { $gt: bestScore } });
  const total = await Player.countDocuments({ bestScore: { $gt: 0 } });
  return { rank: better + 1, totalRankedPlayers: total };
}

function computePercentileFromRank(rank, total) {
  if (!rank || !total || total <= 1) {
    return null;
  }

  const percentile = ((total - rank) / (total - 1)) * 100;
  return Number(percentile.toFixed(2));
}

async function computeSegmentPercentile({ field, value, query = {} }) {
  if (typeof value !== 'number') {
    return { percentile: null, sampleSize: 0 };
  }

  const baseQuery = { verified: true, isValid: true, ...query };
  const sampleSize = await PlayerRun.countDocuments(baseQuery);
  if (sampleSize <= 1) {
    return { percentile: null, sampleSize };
  }

  const better = await PlayerRun.countDocuments({ ...baseQuery, [field]: { $gt: value } });
  const percentile = ((sampleSize - (better + 1)) / (sampleSize - 1)) * 100;

  return {
    percentile: Number(Math.max(0, percentile).toFixed(2)),
    sampleSize
  };
}

function pickComparisonMode(metrics, cfg = DEFAULTS) {
  const candidates = [
    { key: 'first_run_score', percentile: metrics.percentileFirstRunScore, sampleSize: metrics.firstRunScoreSample },
    { key: 'first_run_distance', percentile: metrics.percentileFirstRunDistance, sampleSize: metrics.firstRunDistanceSample },
    { key: 'first_run_coins', percentile: metrics.percentileFirstRunCoins, sampleSize: metrics.firstRunCoinsSample }
  ].filter((item) => item.sampleSize >= cfg.minimumSegmentSize && item.percentile !== null);

  if (!candidates.length) {
    return 'none';
  }

  candidates.sort((a, b) => b.percentile - a.percentile);
  return candidates[0].key;
}

function buildFallbackType({ isFirstRun, comparisonMode, comparisonPercentile }, cfg = DEFAULTS) {
  if (comparisonMode === 'none') {
    return 'normal';
  }

  if (comparisonPercentile !== null && comparisonPercentile < cfg.weakPercentileThreshold) {
    return isFirstRun ? 'weak_first_run' : 'weak_repeat_run';
  }

  return 'normal';
}

function labelForTarget(target) {
  if (target.targetType === 'score') {
    return 'your best';
  }

  if (target.targetType === 'bucket') {
    if (target.bucket === 'top10') return 'TOP 10';
    if (target.bucket === 'top100') return 'TOP 100';
    if (target.bucket === 'top1000') return 'TOP 1000';
    if (target.bucket === 'top10000') return 'TOP 10000';
  }

  return `TOP ${target.targetRank}`;
}

async function getScoreAtRank(targetRank) {
  if (!targetRank || targetRank < 1) {
    return null;
  }

  const rows = await Player.find({ bestScore: { $gt: 0 } })
    .sort({ bestScore: -1 })
    .skip(targetRank - 1)
    .limit(1)
    .select('bestScore');

  return rows?.[0]?.bestScore ?? null;
}

function uniqueTargets(targets) {
  const seen = new Set();
  return targets.filter((target) => {
    const key = `${target.targetType}:${target.targetRank || target.bucket}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function buildNextTargets({ rank, playerScore }, cfg = DEFAULTS) {
  if (!rank || !playerScore || playerScore <= 0) {
    return [];
  }

  const targets = [];

  const addRankTarget = async (targetRank, priority) => {
    if (!targetRank || targetRank >= rank || targetRank < 1) return;

    const scoreAtRank = await getScoreAtRank(targetRank);
    if (typeof scoreAtRank !== 'number') return;

    const delta = Math.max(0, scoreAtRank - playerScore + 1);
    targets.push({
      targetType: 'rank',
      targetRank,
      scoreToReach: scoreAtRank + 1,
      delta,
      priority
    });
  };

  if (rank <= 10) {
    await addRankTarget(Math.max(1, rank - 2), 1);
    await addRankTarget(Math.max(1, rank - 1), 2);
  } else if (rank <= 100) {
    await addRankTarget(10, 1);
    await addRankTarget(Math.max(11, rank - 10), 2);
    targets.push({ targetType: 'bucket', bucket: 'top10', delta: Number.MAX_SAFE_INTEGER, priority: 3 });
  } else if (rank <= 1000) {
    await addRankTarget(100, 1);
    await addRankTarget(Math.max(101, rank - 100), 2);
    targets.push({ targetType: 'bucket', bucket: 'top100', delta: Number.MAX_SAFE_INTEGER, priority: 3 });
  } else if (rank <= 10000) {
    await addRankTarget(1000, 1);
    await addRankTarget(Math.max(1001, rank - 500), 2);
    targets.push({ targetType: 'bucket', bucket: 'top1000', delta: Number.MAX_SAFE_INTEGER, priority: 3 });
  } else {
    await addRankTarget(10000, 1);
    targets.push({ targetType: 'bucket', bucket: 'top10000', delta: Number.MAX_SAFE_INTEGER, priority: 2 });
  }

  const realTargets = uniqueTargets(targets)
    .filter((item) => !(item.targetType === 'rank' && item.delta === 0))
    .sort((a, b) => a.priority - b.priority);

  return realTargets;
}

function pickRecommendedTarget(nextTargets, rank, cfg = DEFAULTS, { currentScore, bestScore } = {}) {
  if (
    typeof bestScore === 'number' && bestScore > 0 &&
    typeof currentScore === 'number' && currentScore < bestScore
  ) {
    // +1 so delta means "points needed to exceed the personal best",
    // consistent with rank target delta calculations.
    const delta = bestScore - currentScore + 1;
    return {
      targetType: 'score',
      type: 'score',
      label: 'your best',
      delta
    };
  }

  if (!nextTargets.length) {
    return null;
  }

  const deltaCap = rank <= 10
    ? cfg.realisticDeltaTop10
    : rank <= 100
      ? cfg.realisticDeltaTop100
      : rank <= 1000
        ? cfg.realisticDeltaTop1000
        : cfg.realisticDeltaTop10000;

  const realistic = nextTargets.find((target) => target.targetType === 'rank' && target.delta <= deltaCap)
    || nextTargets.find((target) => target.targetType === 'rank')
    || nextTargets[0];

  return {
    targetType: realistic.targetType,
    type: realistic.targetType,
    label: labelForTarget(realistic),
    delta: Number.isFinite(realistic.delta) ? realistic.delta : deltaCap
  };
}

async function computePlayerInsights({ wallet, player, latestRun, config = DEFAULTS }) {
  if (!config.insightsEnabled || !wallet || !player) {
    return null;
  }

  const run = latestRun || await PlayerRun.findOne({ wallet, verified: true, isValid: true }).sort({ createdAt: -1 });
  if (!run) {
    return {
      isFirstRun: false,
      isPersonalBest: false,
      enteredTop10: false,
      rank: null,
      totalRankedPlayers: 0,
      percentileOverall: null,
      percentileFirstRunScore: null,
      percentileFirstRunDistance: null,
      percentileFirstRunCoins: null,
      comparisonMode: 'none',
      comparisonTextFallbackType: 'normal',
      nextTargets: [],
      recommendedTarget: null
    };
  }

  const { rank, totalRankedPlayers } = await computeRank(player.bestScore);
  const percentileOverall = computePercentileFromRank(rank, totalRankedPlayers);

  const firstRunScore = await computeSegmentPercentile({
    field: 'score',
    value: run.score,
    query: { isFirstRun: true }
  });

  const firstRunDistance = await computeSegmentPercentile({
    field: 'distance',
    value: run.distance,
    query: { isFirstRun: true }
  });

  const firstRunCoins = await computeSegmentPercentile({
    field: 'goldCoins',
    value: run.goldCoins,
    query: { isFirstRun: true }
  });

  const metrics = {
    percentileFirstRunScore: firstRunScore.percentile,
    firstRunScoreSample: firstRunScore.sampleSize,
    percentileFirstRunDistance: firstRunDistance.percentile,
    firstRunDistanceSample: firstRunDistance.sampleSize,
    percentileFirstRunCoins: firstRunCoins.percentile,
    firstRunCoinsSample: firstRunCoins.sampleSize
  };

  const comparisonMode = pickComparisonMode(metrics, config);
  const comparisonPercentile = comparisonMode === 'first_run_score'
    ? metrics.percentileFirstRunScore
    : comparisonMode === 'first_run_distance'
      ? metrics.percentileFirstRunDistance
      : comparisonMode === 'first_run_coins'
        ? metrics.percentileFirstRunCoins
        : percentileOverall;

  const comparisonTextFallbackType = buildFallbackType({
    isFirstRun: run.isFirstRun,
    comparisonMode,
    comparisonPercentile
  }, config);

  const nextTargets = await buildNextTargets({ rank, playerScore: player.bestScore }, config);
  const recommendedTarget = pickRecommendedTarget(nextTargets, rank, config, {
    currentScore: run.score,
    bestScore: player.bestScore
  });

  return {
    isFirstRun: Boolean(run.isFirstRun),
    isPersonalBest: Boolean(run.isPersonalBest),
    enteredTop10: Boolean(rank && rank <= 10),
    rank,
    totalRankedPlayers,
    percentileOverall,
    percentileFirstRunScore: metrics.percentileFirstRunScore,
    percentileFirstRunDistance: metrics.percentileFirstRunDistance,
    percentileFirstRunCoins: metrics.percentileFirstRunCoins,
    comparisonMode,
    comparisonTextFallbackType,
    nextTargets,
    recommendedTarget
  };
}

module.exports = {
  DEFAULTS,
  computePlayerInsights,
  pickComparisonMode,
  buildFallbackType,
  buildNextTargets,
  pickRecommendedTarget,
  computePercentileFromRank
};
