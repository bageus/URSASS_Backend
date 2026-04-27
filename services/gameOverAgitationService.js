const Player = require('../models/Player');
const PlayerRun = require('../models/PlayerRun');
const mongoose = require('mongoose');

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

function pickNextBucket(rank) {
  if (!rank || rank < 1) return null;
  if (rank > 10000) return 10000;
  if (rank > 1000) return 1000;
  if (rank > 100) return 100;
  if (rank > 10) return 10;
  return null;
}

function computeFirstTimeMilestone(prevRank, currentRank) {
  if (!currentRank || currentRank < 1) return null;
  const milestones = [1, 3, 10, 100, 1000, 10000];
  for (const m of milestones) {
    if (currentRank <= m && (prevRank == null || prevRank > m)) {
      return String(m);
    }
  }
  return null;
}

const AGITATION_RULES = [
  // U1: unauth, score < 1000
  {
    id: 'U1',
    when: ctx => !ctx.isAuthenticated && (ctx.run?.score || 0) < 1000,
    build: () => ({ title: 'TRY AGAIN!', hook: 'You can do better', boost: 'Save your progress & keep improving' })
  },
  // U2: unauth, score >= 1000 && wouldBeRank <= 1000
  {
    id: 'U2',
    when: ctx => !ctx.isAuthenticated && (ctx.run?.score || 0) >= 1000 && ctx.wouldBeRank != null && ctx.wouldBeRank <= 1000,
    build: ctx => ({ title: 'GOOD RUN!', hook: `\u{1F525} You would be #${ctx.wouldBeRank}`, boost: 'Save your score & enter leaderboard' })
  },
  // U3: unauth, score >= 1000 (fallback)
  {
    id: 'U3',
    when: ctx => !ctx.isAuthenticated && (ctx.run?.score || 0) >= 1000,
    build: () => ({ title: 'GOOD RUN!', hook: "You're getting better", boost: 'Save your score & keep progress' })
  },
  // A: first run after auth
  {
    id: 'A',
    when: ctx => ctx.isAuthenticated && ctx.isFirstRunAfterAuth === true,
    build: () => ({ title: 'FIRST RUN!', hook: 'Nice start', boost: "Let's see how far you can go" })
  },
  // B: bad run, was in TOP 3
  {
    id: 'B',
    when: ctx => {
      if (!ctx.isAuthenticated || ctx.prevRank == null || ctx.prevRank > 3) return false;
      const score = ctx.run?.score || 0;
      const isBadRun = score < 1000 || score < (ctx.previousBestScore || 0) * 0.5;
      return isBadRun && !ctx.run?.isPersonalBest;
    },
    build: () => ({ title: 'GOOD RUN!', hook: "You're still TOP 3", boost: "Don't lose your position" })
  },
  // C: bad run, was in TOP 10 (not TOP 3)
  {
    id: 'C',
    when: ctx => {
      if (!ctx.isAuthenticated || ctx.prevRank == null || ctx.prevRank <= 3 || ctx.prevRank > 10) return false;
      const score = ctx.run?.score || 0;
      const isBadRun = score < 1000 || score < (ctx.previousBestScore || 0) * 0.5;
      return isBadRun && !ctx.run?.isPersonalBest;
    },
    build: ctx => ({ title: 'GOOD RUN!', hook: `You're still #${ctx.rank}`, boost: 'Push to stay in TOP 10' })
  },
  // D: bad run, was in leaderboard outside TOP 10
  {
    id: 'D',
    when: ctx => {
      if (!ctx.isAuthenticated || ctx.prevRank == null || ctx.prevRank <= 10) return false;
      const score = ctx.run?.score || 0;
      const isBadRun = score < 1000 || score < (ctx.previousBestScore || 0) * 0.5;
      return isBadRun && !ctx.run?.isPersonalBest;
    },
    build: ctx => ({ title: 'GOOD RUN!', hook: `You're still #${ctx.rank}`, boost: `Your best score: ${ctx.previousBestScore}` })
  },
  // E: bad run, ordinary (score < 1000, not in leaderboard)
  {
    id: 'E',
    when: ctx => ctx.isAuthenticated && (ctx.run?.score || 0) < 1000 && ctx.prevRank == null && !ctx.run?.isPersonalBest,
    build: () => ({ title: 'TRY AGAIN!', hook: 'You can do better', boost: 'Go further this time' })
  },
  // F: first time #1
  {
    id: 'F',
    when: ctx => ctx.isAuthenticated && ctx.run?.isPersonalBest && ctx.rank === 1 && (ctx.prevRank == null || ctx.prevRank > 1) && (ctx.run?.score || 0) >= 1000,
    build: () => ({ title: 'NEW LEADER!', hook: 'No one is above you', boost: "Don't stop. Beat your record." })
  },
  // G: first time TOP 3 (not #1)
  {
    id: 'G',
    when: ctx => ctx.isAuthenticated && ctx.run?.isPersonalBest && ctx.rank <= 3 && ctx.rank > 1 && (ctx.prevRank == null || ctx.prevRank > 3),
    build: () => ({ title: 'TOP 3!', hook: 'Amazing', boost: 'Push to reach #1' })
  },
  // H: first time TOP 10
  {
    id: 'H',
    when: ctx => ctx.isAuthenticated && ctx.firstTimeMilestone === '10',
    build: () => ({ title: 'TOP 10!', hook: 'Now everyone can see you', boost: 'Almost TOP 3' })
  },
  // I: first time TOP 100
  {
    id: 'I',
    when: ctx => ctx.isAuthenticated && ctx.firstTimeMilestone === '100',
    build: () => ({ title: 'TOP 100!', hook: 'Keep climbing', boost: 'Almost TOP 10' })
  },
  // J: first time TOP 1000
  {
    id: 'J',
    when: ctx => ctx.isAuthenticated && ctx.firstTimeMilestone === '1000',
    build: () => ({ title: 'TOP 1000!', hook: "You're improving", boost: 'Next: TOP 100' })
  },
  // K: first time TOP 10000
  {
    id: 'K',
    when: ctx => ctx.isAuthenticated && ctx.firstTimeMilestone === '10000',
    build: () => ({ title: 'IN TOP 10000!', hook: 'Keep climbing', boost: 'Next: TOP 1000' })
  },
  // L: already #1 and beat own record
  {
    id: 'L',
    when: ctx => ctx.isAuthenticated && ctx.prevRank === 1 && ctx.rank === 1 && ctx.run?.isPersonalBest,
    build: () => ({ title: 'NEW RECORD!', hook: 'There are only mountains above you', boost: "Don't stop. Beat your record." })
  },
  // M: already TOP 3, beat own record, position unchanged
  {
    id: 'M',
    when: ctx => ctx.isAuthenticated && ctx.prevRank != null && ctx.prevRank <= 3 && ctx.rank <= 3 && ctx.rank === ctx.prevRank && ctx.run?.isPersonalBest,
    build: () => ({ title: 'NEW PERSONAL RECORD!', hook: 'Amazing', boost: 'Push to reach #1' })
  },
  // N: almost overtook next
  {
    id: 'N',
    when: ctx => ctx.isAuthenticated && (ctx.run?.score || 0) >= 1000 && ctx.run?.isPersonalBest && typeof ctx.nextRankDelta === 'number' && ctx.nextRankDelta > 0 && ctx.nextRankDelta < 10,
    build: ctx => ({ title: 'JUST A BIT MORE!', hook: 'So close', boost: `+${ctx.nextRankDelta} to reach #${ctx.rank - 1}` })
  },
  // O: stuck / no progress
  {
    id: 'O',
    when: ctx => ctx.isAuthenticated && (ctx.run?.score || 0) >= 1000 && !ctx.run?.isPersonalBest && (ctx.consecutiveStuckRuns || 0) >= 3,
    build: () => ({ title: 'NOT BAD!', hook: 'Need more power', boost: 'Upgrade to go further' })
  },
  // Q: personal best, no new milestone (N didn't match since we're here)
  {
    id: 'Q',
    when: ctx => ctx.isAuthenticated && ctx.run?.isPersonalBest && ctx.firstTimeMilestone == null,
    build: () => ({ title: 'PERSONAL BEST!', hook: "You're getting stronger", boost: 'Keep climbing' })
  },
  // P: just average run (fallback for auth with score >= 1000)
  {
    id: 'P',
    when: ctx => ctx.isAuthenticated && (ctx.run?.score || 0) >= 1000 && !ctx.run?.isPersonalBest,
    build: ctx => {
      const delta = (ctx.previousBestScore || 0) - (ctx.run?.score || 0);
      const boost = (ctx.previousBestScore || 0) > 0 && delta > 0 ? `+${delta} to your best` : 'Keep going';
      return { title: 'GOOD RUN!', hook: 'Keep pushing', boost };
    }
  },
  // Fallback
  {
    id: 'fallback',
    when: () => true,
    build: () => ({ title: 'GOOD RUN!', hook: 'Keep pushing', boost: null })
  }
];

function buildAgitationPrompt({
  rank,
  run,
  previousBestScore,
  recommendedTarget = null,
  top1Delta = null,
  top3Delta = null,
  nextRankDelta = null,
  nextBucket = null,
  nextBucketDelta = null,
  percentileFirstRunScore = null,
  isAuthenticated,
  prevRank = null,
  wouldBeRank = null,
  isFirstRunAfterAuth = false,
  firstTimeMilestone = null,
  consecutiveStuckRuns = 0
}) {
  const ctx = {
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
    isAuthenticated,
    prevRank,
    wouldBeRank,
    isFirstRunAfterAuth,
    firstTimeMilestone,
    consecutiveStuckRuns
  };

  for (const rule of AGITATION_RULES) {
    if (rule.when(ctx)) {
      return rule.build(ctx);
    }
  }

  return { title: 'GOOD RUN!', hook: 'Keep pushing', boost: null };
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

async function buildGameOverPayload({
  insights,
  run,
  previousBestScore,
  isAuthenticated,
  wallet = null,
  prevRank = null,
  isFirstRunAfterAuth = false
}) {
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

  // Compute wouldBeRank for unauthenticated players
  let wouldBeRank = null;
  if (!isAuthenticated && (run.score || 0) >= 1000 && mongoose.connection.readyState === 1) {
    try {
      const better = await Player.countDocuments({ bestScore: { $gt: run.score } });
      wouldBeRank = better + 1;
    } catch (_) {
      wouldBeRank = null;
    }
  }

  // Compute consecutiveStuckRuns for authenticated players
  let consecutiveStuckRuns = 0;
  if (isAuthenticated && wallet && mongoose.connection.readyState === 1) {
    try {
      const recent = await PlayerRun.find({ wallet, verified: true, isValid: true })
        .sort({ createdAt: -1 })
        .limit(3)
        .select('isPersonalBest')
        .lean();
      if (recent.length === 3 && recent.every(r => !r.isPersonalBest)) {
        consecutiveStuckRuns = 3;
      }
    } catch (_) {
      consecutiveStuckRuns = 0;
    }
  }

  // Compute firstTimeMilestone
  const firstTimeMilestone = computeFirstTimeMilestone(prevRank, rank);

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
    isAuthenticated,
    prevRank,
    wouldBeRank,
    isFirstRunAfterAuth,
    firstTimeMilestone,
    consecutiveStuckRuns
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
  computeFirstTimeMilestone
};
