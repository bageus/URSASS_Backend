const express = require('express');
const { readLimiter } = require('../middleware/rateLimiter');
const PlayerUpgrades = require('../models/PlayerUpgrades');
const {
  resolvePrimaryIdFromRequest,
  getOrCreateOnboardingState,
  applyRunProgress,
  shouldCountAuthenticatedRun,
  updateStep,
  claimReward
} = require('../services/onboardingService');
const { trackOnboardingEvent } = require('../services/onboardingAnalytics');

const router = express.Router();

function buildStateResponse(state, upgrades) {
  return {
    currentStep: state.currentStep,
    mainFlowCompleted: state.mainFlowCompleted,
    authRunsCount: state.authRunsCount,
    rewards: state.rewards,
    storeIntro: state.storeIntro,
    gifts: {
      radarObstacles: {
        unlocked: state.gifts.radarObstacles.unlocked,
        claimed: state.gifts.radarObstacles.claimed
      },
      radarGold: {
        unlocked: state.gifts.radarGold.unlocked,
        claimed: state.gifts.radarGold.claimed
      }
    },
    activeBoosts: {
      radarObstaclesUntil: upgrades?.temporaryBoosts?.radarObstaclesUntil || null,
      radarGoldUntil: upgrades?.temporaryBoosts?.radarGoldUntil || null
    }
  };
}

router.get('/state', readLimiter, async (req, res) => {
  const primaryId = resolvePrimaryIdFromRequest(req);
  if (!primaryId) return res.status(400).json({ error: 'primaryId_required' });
  const state = await getOrCreateOnboardingState(primaryId);
  const upgrades = await PlayerUpgrades.findOne({ wallet: primaryId });
  return res.json(buildStateResponse(state, upgrades));
});

router.post('/event', async (req, res) => {
  const primaryId = resolvePrimaryIdFromRequest(req);
  if (!primaryId) return res.status(400).json({ error: 'primaryId_required' });
  const event = String(req.body?.event || '').trim();
  const supported = new Set(['wallet_connected', 'run_finished', 'x_connected', 'share_confirmed', 'store_opened', 'ride_pack_bought', 'store_back_clicked', 'skip_step']);
  if (!supported.has(event)) return res.status(400).json({ error: 'unsupported_event' });

  const state = await getOrCreateOnboardingState(primaryId);
  if (event === 'run_finished') {
    const canProgress = await shouldCountAuthenticatedRun(primaryId);
    if (canProgress) {
      applyRunProgress(state);
    }
  }
  if (event === 'store_opened') state.storeIntro.shown = true;
  if (event === 'x_connected' || event === 'share_confirmed') state.storeIntro.unlocked = true;
  if (event === 'ride_pack_bought') {
    state.storeIntro.ridePackBought = true;
  }
  if (event === 'store_back_clicked') {
    state.mainFlowCompleted = true;
    await trackOnboardingEvent('onboarding_completed', { primaryId, flowVersion: state.flowVersion || 'v2' });
  }
  if (event === 'skip_step') {
    state.mainFlowSkipped = true;
    await trackOnboardingEvent('onboarding_step_skipped', { primaryId, flowVersion: state.flowVersion || 'v2', currentStep: state.currentStep });
  }
  updateStep(state);
  await state.save();
  const upgrades = await PlayerUpgrades.findOne({ wallet: primaryId });
  return res.json({ success: true, state: buildStateResponse(state, upgrades) });
});

router.post('/claim', async (req, res) => {
  try {
    const primaryId = resolvePrimaryIdFromRequest(req);
    if (!primaryId) return res.status(400).json({ error: 'primaryId_required' });
    const reward = String(req.body?.reward || '').trim();
    const state = await getOrCreateOnboardingState(primaryId);
    const claim = await claimReward({ state, primaryId, reward });
    if (!claim.alreadyClaimed) {
      await trackOnboardingEvent('onboarding_reward_claimed', { primaryId, reward, flowVersion: state.flowVersion || 'v2' });
      await trackOnboardingEvent('radar_gift_claimed', { primaryId, reward, flowVersion: state.flowVersion || 'v2' });
    }
    return res.json({ success: true, reward, ...claim });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || 'claim_failed' });
  }
});

module.exports = router;
