const Player = require('../models/Player');
const PlayerRun = require('../models/PlayerRun');
const LeaderboardAggregate = require('../models/LeaderboardAggregate');
const logger = require('../utils/logger');

const DEFAULT_REFRESH_INTERVAL_MS = Math.max(60_000, Number(process.env.LEADERBOARD_AGGREGATE_REFRESH_INTERVAL_MS || 5 * 60_000));
let refreshTimer = null;

async function refreshLeaderboardAggregates() {
  const [totalRankedPlayers, firstRunCount] = await Promise.all([
    Player.countDocuments({ bestScore: { $gt: 0 } }),
    PlayerRun.countDocuments({ verified: true, isValid: true, isFirstRun: true })
  ]);

  await LeaderboardAggregate.findOneAndUpdate(
    { key: 'leaderboard_core_stats' },
    {
      key: 'leaderboard_core_stats',
      payload: { totalRankedPlayers, firstRunCount },
      refreshedAt: new Date()
    },
    { upsert: true, new: true }
  );
}

function startLeaderboardAggregateRefreshLoop(intervalMs = DEFAULT_REFRESH_INTERVAL_MS) {
  if (refreshTimer) {
    return refreshTimer;
  }

  const tick = async () => {
    try {
      await refreshLeaderboardAggregates();
    } catch (error) {
      logger.error({ err: error.message }, 'Failed to refresh leaderboard aggregates');
    }
  };

  tick();
  refreshTimer = setInterval(tick, intervalMs);
  if (typeof refreshTimer.unref === 'function') {
    refreshTimer.unref();
  }
  logger.info({ intervalMs }, 'Leaderboard aggregate refresh loop started');
  return refreshTimer;
}

function stopLeaderboardAggregateRefreshLoop() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

module.exports = { refreshLeaderboardAggregates, startLeaderboardAggregateRefreshLoop, stopLeaderboardAggregateRefreshLoop };
