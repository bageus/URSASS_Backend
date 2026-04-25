const Player = require('../models/Player');
const mongoose = require('mongoose');

function formatRankLabel(rank) {
  if (!rank || rank < 1) return 'unranked';
  return `#${rank}`;
}

function chooseLowDeltaTitle() {
  return Math.random() < 0.5 ? 'JUST A BIT MORE!' : 'SO CLOSE!';
}

function resolvePersonalBestHook(rank) {
  if (rank && rank <= 100) return 'You’re in TOP 100!';
  if (rank && rank <= 1000) return 'You’re in TOP 1000!';
  if (rank && rank <= 10000) return 'You’re in TOP 10000!';
  return 'Keep climbing!';
}

function evaluateRunQuality({ score, playerBestBeforeRun }) {
  const baseline = Math.max(1, playerBestBeforeRun || 0);
  const ratio = score / baseline;

  if (!playerBestBeforeRun || playerBestBeforeRun <= 0) {
    if (score >= 500) return 'good';
    if (score >= 250) return 'average';
    return 'weak';
  }

  if (ratio >= 0.95) return 'close_to_best';
  if (ratio >= 0.6) return 'average';
  return 'weak';
}

function buildPracticeModePrompt({ percentileFirstRunScore, rank }) {
  const betterThan = percentileFirstRunScore !== null && percentileFirstRunScore !== undefined
    ? Math.round(percentileFirstRunScore)
    : null;

  const rankLabel = formatRankLabel(rank);
  const wowHook = rank && rank > 0
    ? `🔥WOW! You would be ${rankLabel}`
    : '🔥WOW! Set a score to claim your rank';

  return {
    title: 'GOOD RUN!',
    hook: wowHook,
    boost: betterThan !== null && betterThan >= 60
      ? `Better than ${betterThan}% of new players`
      : 'Practice mode'
  };
}

function resolveBucketMilestone(rank) {
  if (!rank || rank < 1) return null;
  if (rank <= 10) return 'TOP 10';
  if (rank <= 100) return 'TOP 100';
  if (rank <= 1000) return 'TOP 1000';
  if (rank <= 10000) return 'TOP 10000';
  return null;
}

function pickNextBucket(rank) {
  if (!rank || rank < 1) return null;
  if (rank > 10000) return 10000;
  if (rank > 1000) return 1000;
  if (rank > 100) return 100;
  if (rank > 10) return 10;
  return null;
}

function buildAgitationPrompt({
  rank,
  run,
  previousBestScore,
  recommendedTarget,
  top1Delta,
  top3Delta,
  nextRankDelta,
  nextBucket,
  nextBucketDelta,
  percentileFirstRunScore,
  isAuthenticated
}) {
  if (!isAuthenticated) {
    return buildPracticeModePrompt({ percentileFirstRunScore, rank });
  }

  if (rank === 1) {
    return {
      title: '👑 NEW LEADER!',
      hook: Math.random() < 0.5 ? 'No one is above you' : 'You’re at the top of the leaderboard',
      boost: null
    };
  }

  if (rank && rank <= 3) {
    return {
      title: '💥 YOU MADE IT TO TOP 3!',
      hook: Math.random() < 0.5 ? 'You’re among the best players' : 'Only a few are ahead of you',
      boost: typeof top1Delta === 'number' ? `Next +${top1Delta} to #1` : null
    };
  }

  if (run.isPersonalBest && rank && rank <= 10) {
    return {
      title: 'NEW RECORD!',
      hook: Math.random() < 0.5 ? 'You’re among the best players' : 'Only a few are ahead of you',
      boost: typeof top3Delta === 'number' ? `+${top3Delta} points to TOP 3` : null
    };
  }

  if (nextRankDelta !== null && nextRankDelta < 10) {
    return {
      title: chooseLowDeltaTitle(),
      hook: null,
      boost: `+${nextRankDelta} points to pass the next player`
    };
  }

  if (run.isFirstRun) {
    const betterThan = percentileFirstRunScore !== null && percentileFirstRunScore !== undefined
      ? Math.round(percentileFirstRunScore)
      : null;

    let boost = 'Let’s beat it — you can go further';
    if (betterThan !== null && betterThan >= 60) {
      boost = `Better than ${betterThan}% of new players`;
    } else if ((run.score || 0) >= 250) {
      boost = `+${Math.max(1, (previousBestScore || run.score || 0) - (run.score || 0) + 1)} to beat your best`;
    }

    return {
      title: 'FIRST RUN!',
      hook: Math.random() < 0.5 ? 'You’re off to a great start' : 'Nice start',
      boost
    };
  }

  if (run.isPersonalBest) {
    const farBucketThreshold = 1500;
    const canPushBucket = typeof nextBucketDelta === 'number' && nextBucketDelta <= farBucketThreshold;
    const nextBucketLabel = nextBucket ? `TOP ${nextBucket}` : null;

    return {
      title: 'PERSONAL BEST!',
      hook: resolveBucketMilestone(rank)
        ? `You reached ${resolveBucketMilestone(rank)}`
        : resolvePersonalBestHook(rank),
      boost: canPushBucket && nextBucketLabel
        ? `+${nextBucketDelta} points to ${nextBucketLabel}`
        : typeof nextRankDelta === 'number'
          ? `+${nextRankDelta} points to pass the next player`
          : (recommendedTarget ? `+${recommendedTarget.delta} points to ${recommendedTarget.label}` : null)
    };
  }

  if (!run.isFirstRun && previousBestScore > 0 && (run.score || 0) < previousBestScore) {
    return {
      title: 'GOON RUN!',
      hook: 'You can go further',
      boost: `Beat your best score +${Math.max(1, previousBestScore - (run.score || 0) + 1)}`
    };
  }

  if (!run.isFirstRun && previousBestScore > 0 && (run.score || 0) >= previousBestScore) {
    return {
      title: 'GOOD RUN!',
      hook: 'You can go further',
      boost: typeof nextBucketDelta === 'number' && nextBucket
        ? `+${nextBucketDelta} points to TOP ${nextBucket}`
        : typeof nextRankDelta === 'number'
          ? `+${nextRankDelta} points to pass the next player`
        : (recommendedTarget ? `+${recommendedTarget.delta} points to ${recommendedTarget.label}` : null)
    };
  }
  const quality = evaluateRunQuality({ score: run.score || 0, playerBestBeforeRun: previousBestScore || 0 });
  let hook = 'Keep climbing';
  let boost = typeof nextRankDelta === 'number'
    ? `+${nextRankDelta} to the next rank`
    : null;

  if (quality === 'close_to_best') {
    hook = 'Almost a new best';
    boost = `Only +${Math.max(1, (previousBestScore || 0) - (run.score || 0) + 1)} to your record`;
  } else if (quality === 'average') {
    hook = 'Keep climbing';
  } else {
    hook = 'Warm-up run';
  }

  return {
    title: 'GOOD RUN!',
    hook,
    boost
  };
}

async function getScoreAtRank(rank) {
  if (!rank || rank < 1) return null;
  if (mongoose.connection.readyState !== 1) return null;

  let rows;
  try {
    rows = await Player.find({ bestScore: { $gt: 0 } })
      .sort({ bestScore: -1 })
      .skip(rank - 1)
      .limit(1)
      .select('wallet bestScore');
  } catch (error) {
    return null;
  }

  const row = rows?.[0] || null;
  return row ? { wallet: row.wallet, bestScore: row.bestScore } : null;
}

async function buildGameOverLeaderboardSlice(rank) {
  if (!rank || rank < 2) {
    return { mode: 'top', rows: [] };
  }

  const around = await Player.find({ bestScore: { $gt: 0 } })
    .sort({ bestScore: -1 })
    .skip(Math.max(0, rank - 2))
    .limit(3)
    .select('wallet bestScore');

  const rows = around.map((item, idx) => {
    const position = Math.max(1, rank - 1 + idx);
    return {
      position,
      wallet: item.wallet,
      bestScore: item.bestScore,
      isCurrentPlayerRow: position === rank,
      isDimmed: position !== rank
    };
  });

  return {
    mode: rank > 10 ? 'around_player' : 'top',
    rows
  };
}

async function buildGameOverPayload({ insights, run, previousBestScore, isAuthenticated }) {
  const rank = insights?.rank || null;
  const top1 = await getScoreAtRank(1);
  const top3 = await getScoreAtRank(3);
  const next = rank && rank > 1 ? await getScoreAtRank(rank - 1) : null;
  const nextBucket = pickNextBucket(rank);
  const bucketTarget = nextBucket ? await getScoreAtRank(nextBucket) : null;

  const playerLeaderboardScore = Math.max(run.score || 0, previousBestScore || 0);
  const top1Delta = top1?.bestScore ? Math.max(1, top1.bestScore - playerLeaderboardScore + 1) : null;
  const top3Delta = top3?.bestScore ? Math.max(1, top3.bestScore - playerLeaderboardScore + 1) : null;
  const nextRankDelta = next?.bestScore ? Math.max(1, next.bestScore - playerLeaderboardScore + 1) : null;
  const nextBucketDelta = bucketTarget?.bestScore
    ? Math.max(1, bucketTarget.bestScore - playerLeaderboardScore + 1)
    : null;

  const prompt = buildAgitationPrompt({
    rank,
    run,
    previousBestScore,
    recommendedTarget: insights?.recommendedTarget || null,
    top1Delta,
    top3Delta,
    nextRankDelta,
    nextBucket,
    nextBucketDelta,
    percentileFirstRunScore: insights?.percentileFirstRunScore ?? null,
    isAuthenticated
  });

  const leaderboardSlice = isAuthenticated
    ? await buildGameOverLeaderboardSlice(rank)
    : null;

  return {
    title: prompt.title,
    hook: prompt.hook,
    boost: prompt.boost,
    rank,
    recommendedTarget: insights?.recommendedTarget || null,
    leaderboardSlice
  };
}

module.exports = {
  buildAgitationPrompt,
  buildGameOverPayload,
  buildGameOverLeaderboardSlice,
  evaluateRunQuality,
  resolvePersonalBestHook
};
