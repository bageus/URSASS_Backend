const crypto = require('crypto');

const REFERRAL_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const REFERRAL_CODE_LENGTH = 8;

/**
 * Generate an 8-character referral code using an unambiguous alphabet
 * (no 0, O, 1, I, L to avoid confusion).
 */
function generateReferralCode() {
  let code = '';
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    code += REFERRAL_ALPHABET.charAt(crypto.randomInt(REFERRAL_ALPHABET.length));
  }
  return code;
}

/**
 * Build a referral URL for a given code.
 * Prefers FRONTEND_BASE_URL env, falls back to PUBLIC_BASE_URL, then request origin.
 *
 * @param {string} code - The referral code
 * @param {object|null} req - Express request (used as fallback for base URL)
 * @returns {string}
 */
function buildReferralUrl(code, req) {
  const base = (
    process.env.FRONTEND_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    ''
  ).replace(/\/+$/, '');

  if (base) {
    return `${base}/?ref=${code}`;
  }

  if (req) {
    const origin = req.get('origin') || `${req.protocol}://${req.get('host')}`;
    return `${origin}/?ref=${code}`;
  }

  return `/?ref=${code}`;
}

module.exports = { generateReferralCode, buildReferralUrl };
