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

function sanitizeReferralCode(refCode) {
  const value = String(refCode || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    return '';
  }
  return value;
}

function buildCanonicalShareUrl(refCode, req) {
  const safeRefCode = sanitizeReferralCode(refCode);
  if (!safeRefCode) return '';

  const publicBase = (
    process.env.PUBLIC_BASE_URL ||
    process.env.APP_BASE_URL ||
    ''
  ).replace(/\/+$/, '');

  const base = publicBase || (req ? `${req.protocol}://${req.get('host')}` : '');
  return `${base}/s/${encodeURIComponent(safeRefCode)}`;
}

function buildReferralLandingUrl(refCode, req) {
  const safeRefCode = sanitizeReferralCode(refCode);
  const frontendBaseUrl = (process.env.FRONTEND_BASE_URL || 'https://ursasstube.fun').trim().replace(/\/+$/, '');
  if (!safeRefCode) return `${frontendBaseUrl}/`;

  const preferTelegram = String(process.env.PREFER_TELEGRAM_REFERRAL || 'true').toLowerCase() === 'true';
  const botUsername = String(process.env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@+/, '');
  const shortName = String(process.env.TELEGRAM_MINI_APP_SHORT_NAME || '').trim();
  const encoded = encodeURIComponent(`ref_${safeRefCode}`);

  if (preferTelegram && botUsername) {
    if (shortName) {
      return `https://t.me/${botUsername}/${shortName}?startapp=${encoded}`;
    }
    return `https://t.me/${botUsername}?start=${encoded}`;
  }

  return `${frontendBaseUrl}/?ref=${encodeURIComponent(safeRefCode)}`;
}

function isSocialPreviewCrawler(userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  if (!ua) return false;
  return /(twitterbot|x\.com|facebookexternalhit|slackbot|telegrambot|discordbot|whatsapp|linkedinbot|pinterest|google-inspectiontool|applebot|skypeuripreview|quora link preview|embedly|vkshare|preview)/i.test(ua);
}

module.exports = { generateReferralCode, buildReferralUrl, sanitizeReferralCode, buildReferralLandingUrl, isSocialPreviewCrawler, buildCanonicalShareUrl };
