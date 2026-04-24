const Player = require('../models/Player');
const PlayerRun = require('../models/PlayerRun');
const LeaderboardAggregate = require('../models/LeaderboardAggregate');

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

module.exports = { refreshLeaderboardAggregates };
