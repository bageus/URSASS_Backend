const Player = require('../models/Player');
const { addGold } = require('./goldWallet');
const { recordCoinReward } = require('./coinHistory');
const logger = require('./logger');

const REFERRER_GOLD = Number(process.env.REFERRAL_REWARD_REFERRER_GOLD || 50);
const REFEREE_GOLD = Number(process.env.REFERRAL_REWARD_REFEREE_GOLD || 100);

/**
 * Grant referral rewards after a player's first valid run.
 *
 * - Referrer receives REFERRAL_REWARD_REFERRER_GOLD (default 50)
 * - Referee (current player) receives REFERRAL_REWARD_REFEREE_GOLD (default 100)
 * - Marks player.referralRewardGranted = true so it only happens once.
 *
 * @param {object} player - Mongoose Player document
 * @param {object} [opts]
 * @param {string} [opts.requestId] - For log correlation
 */
async function maybeGrantReferralRewards(player, opts = {}) {
  const requestId = opts.requestId;
  if (!player) {
    logger.warn('maybeGrantReferralRewards: player missing');
    return;
  }
  if (player.referralRewardGranted) {
    logger.info({ wallet: player.wallet, requestId }, 'maybeGrantReferralRewards: skip — already granted');
    return;
  }
  if (!player.referredBy) {
    logger.info({ wallet: player.wallet, requestId }, 'maybeGrantReferralRewards: skip — player has no referredBy');
    return;
  }

  // Find the referrer by their referralCode
  const referrer = await Player.findOne({ referralCode: player.referredBy });
  if (!referrer) {
    logger.warn(
      { playerId: player._id, referredBy: player.referredBy, requestId: opts.requestId },
      'maybeGrantReferralRewards: referrer not found'
    );
    return;
  }

  // Award gold to referrer
  await addGold(referrer.wallet, REFERRER_GOLD, 'referral_referrer', opts);
  await recordCoinReward(referrer.wallet, 'refer', { gold: REFERRER_GOLD }, opts);

  // Award gold to referee (current player)
  await addGold(player.wallet, REFEREE_GOLD, 'referral_referee', opts);
  await recordCoinReward(player.wallet, 'referral', { gold: REFEREE_GOLD }, opts);

  // Mark as granted
  player.referralRewardGranted = true;
  await player.save();

  logger.info(
    {
      refereePrimaryId: player.wallet,
      referrerPrimaryId: referrer.wallet,
      referrerGold: REFERRER_GOLD,
      refereeGold: REFEREE_GOLD,
      requestId: opts.requestId
    },
    'referral_reward_granted'
  );
}

module.exports = { maybeGrantReferralRewards };
