const Player = require('../models/Player');
const { addGold } = require('./goldWallet');
const logger = require('./logger');

const REFERRAL_REWARD_REFERRER = Number(process.env.REFERRAL_REWARD_REFERRER_GOLD || 50);
const REFERRAL_REWARD_REFEREE = Number(process.env.REFERRAL_REWARD_REFEREE_GOLD || 100);

/**
 * Grant referral rewards after a player completes their first valid run.
 * - Referrer gets REFERRAL_REWARD_REFERRER_GOLD (default 50)
 * - Referee (the new player) gets REFERRAL_REWARD_REFEREE_GOLD (default 100)
 * Idempotent: does nothing if rewards already granted or no referrer set.
 */
async function maybeGrantReferralRewards(player) {
  if (!player) return;
  if (player.referralRewardGranted) return;
  if (!player.referredBy) return;

  const referrer = await Player.findOne({ referralCode: player.referredBy });
  if (!referrer) {
    logger.warn(
      { playerWallet: player.wallet, referredBy: player.referredBy },
      'maybeGrantReferralRewards: referrer not found'
    );
    return;
  }

  try {
    await addGold(referrer.wallet, REFERRAL_REWARD_REFERRER, 'referral_referrer');
    await addGold(player.wallet, REFERRAL_REWARD_REFEREE, 'referral_referee');

    player.referralRewardGranted = true;
    await player.save();

    logger.info(
      {
        referreePrimaryId: player.wallet,
        referrerPrimaryId: referrer.wallet,
        referrerGold: REFERRAL_REWARD_REFERRER,
        refereeGold: REFERRAL_REWARD_REFEREE
      },
      'referral_reward_granted'
    );
  } catch (err) {
    logger.error({ err: err.message, playerWallet: player.wallet }, 'maybeGrantReferralRewards error');
  }
}

module.exports = { maybeGrantReferralRewards };
