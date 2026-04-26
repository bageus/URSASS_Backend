const { customAlphabet } = require('nanoid');

const REFERRAL_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const generateNanoid = customAlphabet(REFERRAL_ALPHABET, 8);

/**
 * Generate an 8-character referral code using an unambiguous alphabet
 * (no 0, O, 1, I, L).
 */
function generateReferralCode() {
  return generateNanoid();
}

function stripTrailingSlash(url) {
  let result = url;
  while (result.endsWith('/')) {
    result = result.slice(0, -1);
  }
  return result;
}

/**
 * Build the public referral URL for a given code.
 * Uses FRONTEND_BASE_URL env first, then PUBLIC_BASE_URL, then derives from req.
 */
function buildReferralUrl(code, req) {
  const configured = process.env.FRONTEND_BASE_URL || process.env.PUBLIC_BASE_URL || '';
  const base = configured
    ? stripTrailingSlash(configured)
    : (req ? `${req.protocol}://${req.get('host')}` : '');

  return `${base}/?ref=${code}`;
}

module.exports = { generateReferralCode, buildReferralUrl };
