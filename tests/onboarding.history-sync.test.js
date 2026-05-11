const test = require('node:test');
const assert = require('node:assert/strict');

const Player = require('../models/Player');
const PlayerRun = require('../models/PlayerRun');
const GameResult = require('../models/GameResult');
const {
  getGameplayHistorySnapshot,
  alignOnboardingStateWithGameplayHistory
} = require('../services/onboardingService');

function makeState() {
  return {
    mainFlowCompleted: false,
    currentStep: 'auth_start',
    authRunsCount: 0,
    storeIntro: { shown: false, unlocked: false, ridePackBought: false },
    rewards: {
      silverAfterSecondRunGranted: false,
      goldAfterThirdRunGranted: false
    },
    gifts: {
      radarObstacles: { unlocked: false },
      radarGold: { unlocked: false }
    }
  };
}

test('getGameplayHistorySnapshot returns zeroed snapshot for player with no history', async () => {
  const originalPlayerFindOne = Player.findOne;
  const originalPlayerRunCount = PlayerRun.countDocuments;
  const originalGameResultCount = GameResult.countDocuments;

  Player.findOne = () => ({ select: () => ({ lean: async () => null }) });
  PlayerRun.countDocuments = async () => 0;
  GameResult.countDocuments = async () => 0;

  try {
    const snapshot = await getGameplayHistorySnapshot('0xnew');
    assert.equal(snapshot.completedRunsCount, 0);
    assert.equal(snapshot.gamesPlayed, 0);
    assert.equal(snapshot.leaderboardEntries, 0);
    assert.equal(snapshot.finishedSessions, 0);
    assert.equal(snapshot.hasGameplayHistory, false);
  } finally {
    Player.findOne = originalPlayerFindOne;
    PlayerRun.countDocuments = originalPlayerRunCount;
    GameResult.countDocuments = originalGameResultCount;
  }
});

test('alignOnboardingStateWithGameplayHistory keeps new auth user at auth_start', () => {
  const state = makeState();
  alignOnboardingStateWithGameplayHistory(state, {
    completedRunsCount: 0,
    gamesPlayed: 0,
    leaderboardEntries: 0,
    finishedSessions: 0,
    hasGameplayHistory: false
  });

  assert.equal(state.mainFlowCompleted, false);
  assert.equal(state.currentStep, 'auth_start');
  assert.equal(state.authRunsCount, 0);
});

test('alignOnboardingStateWithGameplayHistory restores progression from gameplay history', () => {
  const state = makeState();
  alignOnboardingStateWithGameplayHistory(state, {
    completedRunsCount: 3,
    gamesPlayed: 3,
    leaderboardEntries: 1,
    finishedSessions: 3,
    hasGameplayHistory: true
  });

  assert.equal(state.authRunsCount, 3);
  assert.equal(state.currentStep, 'auth_run_3_done');
});
