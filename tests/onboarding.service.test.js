const test = require('node:test');
const assert = require('node:assert/strict');

const { applyRunProgress, resolveActiveOnboarding, ONBOARDING_KEYS } = require('../services/onboardingService');

function baseState() {
  return {
    authRunsCount: 0,
    rewards: { secondRaceSilver100Claimed: false, thirdRaceGold100Claimed: false },
    gifts: { radarObstacles: { unlocked: false, claimed: false }, radarGold: { unlocked: false, claimed: false } },
    onboarding: new Map(ONBOARDING_KEYS.map((key) => [key, { status: 'none', shownContext: [], updatedAt: new Date() }]))
  };
}

test('applyRunProgress grants silver on second auth run exactly once', () => {
  const state = baseState();
  const r1 = applyRunProgress(state, 1);
  assert.equal(r1.silverBonus, 0);
  const r2 = applyRunProgress(state, 2);
  assert.equal(r2.silverBonus, 100);
  const r3 = applyRunProgress(state, 3);
  assert.equal(r3.silverBonus, 0);
});

test('applyRunProgress grants gold on third auth run exactly once', () => {
  const state = baseState();
  applyRunProgress(state, 2);
  const r3 = applyRunProgress(state, 3);
  assert.equal(r3.goldBonus, 100);
  const r4 = applyRunProgress(state, 4);
  assert.equal(r4.goldBonus, 0);
});

test('resolveActiveOnboarding returns first_race on menu for zero runs', () => {
  const state = baseState();
  const active = resolveActiveOnboarding({ state, raceCount: 0, xConnected: false, screen: 'menu' });
  assert.equal(active?.key, 'first_race');
});

test('resolveActiveOnboarding returns second_race_game_over for one run on game-over screen', () => {
  const state = baseState();
  const active = resolveActiveOnboarding({ state, raceCount: 1, xConnected: false, screen: 'game-over' });
  assert.deepEqual(active, {
    key: 'second_race_game_over',
    screen: 'game-over',
    target: 'play_again',
    hook: 'Play again and get +100 silver'
  });
});

test('resolveActiveOnboarding returns second_race_menu for one run on menu screen', () => {
  const state = baseState();
  const active = resolveActiveOnboarding({ state, raceCount: 1, xConnected: false, screen: 'menu' });
  assert.deepEqual(active, {
    key: 'second_race_menu',
    screen: 'menu',
    target: 'start_game',
    hook: 'Play again and get +100 silver'
  });
});

test('resolveActiveOnboarding does not return second-race keys when status is skip or complete', () => {
  const skipped = baseState();
  skipped.onboarding.set('second_race_menu', {
    ...skipped.onboarding.get('second_race_menu'),
    status: 'skip'
  });
  const activeMenu = resolveActiveOnboarding({ state: skipped, raceCount: 1, xConnected: false, screen: 'menu' });
  assert.equal(activeMenu, null);

  const completed = baseState();
  completed.onboarding.set('second_race_game_over', {
    ...completed.onboarding.get('second_race_game_over'),
    status: 'complete'
  });
  const activeGameOver = resolveActiveOnboarding({ state: completed, raceCount: 1, xConnected: false, screen: 'game-over' });
  assert.equal(activeGameOver, null);
});

test('resolveActiveOnboarding never returns share result onboarding on menu screen', () => {
  const state = baseState();
  const active = resolveActiveOnboarding({ state, raceCount: 3, xConnected: false, screen: 'menu' });
  assert.notEqual(active?.key, 'share_result_game_over');
  assert.notEqual(active?.key, 'share_result_player_menu');
});

test('resolveActiveOnboarding returns share_result_player_menu on player-menu for 3+ runs and disconnected X', () => {
  const state = baseState();
  const active = resolveActiveOnboarding({ state, raceCount: 3, xConnected: false, screen: 'player-menu' });
  assert.deepEqual(active, {
    key: 'share_result_player_menu',
    screen: 'player-menu',
    target: 'player_menu_connect_x',
    hook: 'Connect X and get a bonus'
  });
});

test('resolveActiveOnboarding still returns share_result_game_over on game-over for 3+ runs and disconnected X', () => {
  const state = baseState();
  const active = resolveActiveOnboarding({ state, raceCount: 3, xConnected: false, screen: 'game-over' });
  assert.deepEqual(active, {
    key: 'share_result_game_over',
    screen: 'game-over',
    target: 'connect_x_or_share_result',
    hook: 'Share your result and get a bonus'
  });
});
