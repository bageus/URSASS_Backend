const test = require('node:test');
const assert = require('node:assert/strict');

const { applyRunProgress, updateStep } = require('../services/onboardingService');

function baseState() {
  return {
    mainFlowCompleted: false,
    storeIntro: { ridePackBought: false },
    currentStep: 'auth_start',
    authRunsCount: 0,
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

test('applyRunProgress grants silver on second auth run exactly once', () => {
  const state = baseState();

  const r1 = applyRunProgress(state);
  assert.equal(r1.silverBonus, 0);
  assert.equal(state.rewards.silverAfterSecondRunGranted, false);

  const r2 = applyRunProgress(state);
  assert.equal(r2.silverBonus, 100);
  assert.equal(state.rewards.silverAfterSecondRunGranted, true);

  const r3 = applyRunProgress(state);
  assert.equal(r3.silverBonus, 0);
});

test('applyRunProgress grants gold on third auth run exactly once', () => {
  const state = baseState();
  applyRunProgress(state);
  applyRunProgress(state);

  const r3 = applyRunProgress(state);
  assert.equal(r3.goldBonus, 100);
  assert.equal(state.rewards.goldAfterThirdRunGranted, true);

  const r4 = applyRunProgress(state);
  assert.equal(r4.goldBonus, 0);
});

test('applyRunProgress unlocks radar gifts at 6 and 15 runs', () => {
  const state = baseState();

  for (let i = 0; i < 6; i += 1) applyRunProgress(state);
  assert.equal(state.gifts.radarObstacles.unlocked, true);
  assert.equal(state.gifts.radarGold.unlocked, false);

  for (let i = 6; i < 15; i += 1) applyRunProgress(state);
  assert.equal(state.gifts.radarGold.unlocked, true);
});

test('updateStep moves to store_intro after 3rd run and completed after ride pack', () => {
  const state = baseState();
  state.authRunsCount = 3;
  updateStep(state);
  assert.equal(state.currentStep, 'auth_run_3_done');

  state.mainFlowCompleted = true;
  state.storeIntro.ridePackBought = true;
  updateStep(state);
  assert.equal(state.currentStep, 'completed');
});
