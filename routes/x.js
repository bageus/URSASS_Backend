/**
 * routes/x.js  –  X (Twitter) OAuth 2.0 PKCE flow
 *
 * Endpoints:
 *   GET  /oauth/start     – Redirect to X authorization (auth required)
 *   GET  /oauth/callback  – X redirects here after user grants access
 *   POST /disconnect      – Revoke and unlink X account (auth required)
 *   GET  /status          – Return X connection status (auth required)
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const rateLimit = require('express-rate-limit');
const OAuthState = require('../models/OAuthState');
const Player = require('../models/Player');
const AccountLink = require('../models/AccountLink');
const xOAuth = require('../utils/xOAuth');
const { buildReferralUrl } = require('../utils/referral');
const { logSecurityEvent } = require('../utils/security');
const logger = require('../utils/logger');
const { findLink } = require('../middleware/requireAuth');

const FRONTEND_BASE_URL = () => (process.env.FRONTEND_BASE_URL || 'https://ursasstube.fun').replace(/\/+$/, '');

// Minimum primaryId length to show partial chars instead of fully redacting
const MIN_ID_LENGTH_FOR_MASKING = 6;

function maskedPrimaryId(primaryId) {
  if (!primaryId || typeof primaryId !== 'string') return '***';
  return primaryId.length > MIN_ID_LENGTH_FOR_MASKING
    ? `${primaryId.slice(0, 3)}***${primaryId.slice(-3)}`
    : '***';
}


function classifyShareResultError(err) {
  const status = Number(err?.response?.status || err?.status || 0);
  if (status === 401) {
    return { statusCode: 401, error: 'x_auth_expired', retryable: false, fallback: null };
  }
  if (status === 429) {
    return { statusCode: 429, error: 'x_rate_limited', retryable: true, fallback: 'text_intent' };
  }
  if (status === 403) {
    return { statusCode: 401, error: 'x_auth_expired', retryable: false, fallback: null };
  }
  if ([400, 404, 413, 415, 422].includes(status)) {
    return { statusCode: 502, error: 'x_media_upload_failed', retryable: true, fallback: 'text_intent' };
  }
  return { statusCode: 502, error: 'x_post_failed', retryable: true, fallback: 'text_intent' };
}


function extractUpstreamError(err) {
  const status = Number(err?.response?.status || 0) || null;
  const data = err?.response?.data || null;
  const detail = typeof data === 'string'
    ? data.slice(0, 280)
    : (data?.detail || data?.title || data?.error || data?.message || null);
  return { upstreamStatus: status, upstreamDetail: detail };
}

function getClientIp(req) {
  const xff = req.get('x-forwarded-for');
  if (xff && typeof xff === 'string') {
    const first = xff.split(',').map((v) => v.trim()).find(Boolean);
    if (first) return first;
  }
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

const oauthStartLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many OAuth start requests. Please wait.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp
});

const disconnectLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many disconnect requests. Please wait.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp
});

const oauthCallbackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many OAuth callback requests. Please wait.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp
});

const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many status requests. Please wait.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp
});

const shareResultLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many share requests. Please wait.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getClientIp
});

const SHARE_COPY_TEMPLATE = 'I scored {score} in Ursass Tube 🐻\nCan you beat me?';
const SHARE_HASHTAGS = '#UrsassTube #Ursas #Ursasplanet #GameChallenge #HighScore';

function getPublicBaseUrl(req) {
  const configured = (process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '').trim();
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}


const STATIC_SHARE_IMAGE_PATH = path.join(__dirname, '..', 'img', 'score_result.png');

async function loadStaticShareImagePng() {
  return fs.readFile(STATIC_SHARE_IMAGE_PATH);
}
function buildSharePostText(score, referralUrl) {
  const normalizedScore = Math.max(0, Math.floor(Number(score || 0)));
  const main = SHARE_COPY_TEMPLATE.replace('{score}', normalizedScore);
  const parts = [main, referralUrl ? referralUrl.trim() : '', SHARE_HASHTAGS].filter(Boolean);
  return parts.join('\n');
}

/**
 * Resolve authenticated primaryId from request headers.
 * Returns AccountLink if valid, null otherwise.
 * Supports X-Primary-Id and X-Wallet with cross-field fallbacks.
 */
async function resolveAuth(req) {
  const rawPrimaryId = (
    req.get('x-primary-id') ||
    req.get('X-Primary-Id') ||
    req.body?.primaryId ||
    ''
  ).trim().toLowerCase();

  const rawWallet = (req.get('x-wallet') || '').trim().toLowerCase();
  const initData = req.get('x-telegram-init-data') || req.get('X-Telegram-Init-Data') || '';

  const link = await findLink(rawPrimaryId, rawWallet, initData);
  if (!link || link.__invalid) return null;

  return link;
}

/**
 * Graceful degradation: if X OAuth is not configured, return 503.
 */
function requireXOAuth(req, res, next) {
  if (!xOAuth.isXOAuthConfigured()) {
    return res.status(503).json({ error: 'x_oauth_not_configured' });
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /oauth/start
// ─────────────────────────────────────────────────────────────────────────────

router.get('/oauth/start', oauthStartLimiter, requireXOAuth, async (req, res) => {
  try {
    const link = await resolveAuth(req);
    if (!link) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const primaryId = link.primaryId;
    const maskedId = maskedPrimaryId(primaryId);
    logger.info({ primaryId: maskedId, mode: req.query.mode || 'redirect' }, 'GET /x/oauth/start');

    const state = crypto.randomBytes(32).toString('hex');
    const { codeVerifier, codeChallenge } = xOAuth.generatePkcePair();

    await OAuthState.create({ state, primaryId, codeVerifier });

    const authorizeUrl = xOAuth.buildAuthorizeUrl({ state, codeChallenge });

    // ?mode=json → return JSON so frontend can open in new tab
    if (req.query.mode === 'json') {
      return res.json({ authorizeUrl });
    }

    return res.redirect(302, authorizeUrl);
  } catch (err) {
    logger.error({ err: err.message }, 'GET /x/oauth/start error');
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /oauth/callback
// ─────────────────────────────────────────────────────────────────────────────

router.get('/oauth/callback', oauthCallbackLimiter, requireXOAuth, async (req, res) => {
  const frontendBase = FRONTEND_BASE_URL();

  try {
    const { code, state, error: xError } = req.query;

    // X reported an error
    if (xError) {
      logger.warn({ reason: xError }, 'X OAuth callback error from provider');
      return res.redirect(302, `${frontendBase}/?x=error&reason=${encodeURIComponent(xError)}`);
    }

    if (!code || !state) {
      return res.redirect(302, `${frontendBase}/?x=error&reason=missing_params`);
    }

    // Validate state format: must be a 64-char hex string (from crypto.randomBytes(32).toString('hex'))
    const stateStr = String(state);
    if (!/^[0-9a-f]{64}$/.test(stateStr)) {
      return res.redirect(302, `${frontendBase}/?x=error&reason=invalid_state`);
    }

    // Validate state
    const oauthState = await OAuthState.findOne({ state: stateStr });
    if (!oauthState) {
      logger.warn({}, 'X OAuth callback: invalid or expired state');
      await logSecurityEvent({
        eventType: 'x_oauth_invalid_state',
        route: '/api/x/oauth/callback',
        ipAddress: getClientIp(req),
        details: {}
      });
      return res.redirect(302, `${frontendBase}/?x=error&reason=invalid_state`);
    }

    const { primaryId, codeVerifier } = oauthState;

    // Exchange code for tokens
    let tokenData;
    try {
      tokenData = await xOAuth.exchangeCodeForToken({ code, codeVerifier });
    } catch (err) {
      logger.error({ err: err.message }, 'X OAuth token exchange failed');
      await OAuthState.deleteOne({ state: stateStr });
      return res.redirect(302, `${frontendBase}/?x=error&reason=token_exchange_failed`);
    }

    const { access_token: accessToken, refresh_token: refreshToken } = tokenData;

    // Fetch user info
    let xUser;
    try {
      xUser = await xOAuth.fetchXUser(accessToken);
    } catch (err) {
      logger.error({ err: err.message }, 'X OAuth fetchXUser failed');
      await OAuthState.deleteOne({ state: stateStr });
      return res.redirect(302, `${frontendBase}/?x=error&reason=fetch_user_failed`);
    }

    const { id: xUserId, username: xUsername } = xUser;

    if (!xUserId) {
      await OAuthState.deleteOne({ state: stateStr });
      return res.redirect(302, `${frontendBase}/?x=error&reason=user_id_missing`);
    }

    // Check if this X account is already linked to a different player
    const existing = await Player.findOne({ xUserId, wallet: { $ne: primaryId } }).select('wallet').lean();
    if (existing) {
      const ownerPrimaryId = existing.wallet;
      logger.warn(
        { xUserId, requestingPrimaryId: primaryId, ownerPrimaryId },
        'X account already linked to another player — security event'
      );
      await logSecurityEvent({
        wallet: primaryId,
        eventType: 'x_oauth_already_linked_to_another_player',
        route: '/api/x/oauth/callback',
        ipAddress: getClientIp(req),
        details: { xUserId, xUsername, ownerPrimaryId, requestingPrimaryId: primaryId }
      });
      await OAuthState.deleteOne({ state: stateStr });
      return res.redirect(302, `${frontendBase}/?x=error&reason=already_linked_to_another_player`);
    }

    // Update player record
    player = await Player.findOne({ wallet: primaryId }).select('+xAccessToken +xRefreshToken');
    if (!player) {
      await OAuthState.deleteOne({ state: stateStr });
      return res.redirect(302, `${frontendBase}/?x=error&reason=player_not_found`);
    }

    player.xUserId = xUserId;
    player.xUsername = xUsername || null;
    player.xAccessToken = accessToken;
    player.xRefreshToken = refreshToken || null;
    player.xConnectedAt = new Date();
    await player.save();

    // Clean up state
    await OAuthState.deleteOne({ state: stateStr });

    logger.info({ primaryId, xUserId, xUsername: xUsername || null }, 'X account connected');

    return res.redirect(
      302,
      `${frontendBase}/?x=connected&username=${encodeURIComponent(xUsername || '')}`
    );
  } catch (err) {
    logger.error({ err: err.message }, 'GET /x/oauth/callback unhandled error');
    return res.redirect(302, `${frontendBase}/?x=error&reason=server_error`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /disconnect
// ─────────────────────────────────────────────────────────────────────────────

router.post('/disconnect', disconnectLimiter, requireXOAuth, async (req, res) => {
  try {
    const link = await resolveAuth(req);
    if (!link) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const primaryId = link.primaryId;

    player = await Player.findOne({ wallet: primaryId }).select('+xAccessToken +xRefreshToken');
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    // Best-effort revoke
    if (player.xRefreshToken) {
      await xOAuth.revokeToken(player.xRefreshToken);
    }

    player.xUserId = null;
    player.xUsername = null;
    player.xAccessToken = null;
    player.xRefreshToken = null;
    player.xConnectedAt = null;
    await player.save();

    logger.info({ primaryId }, 'X account disconnected');

    return res.json({ disconnected: true });
  } catch (err) {
    logger.error({ err: err.message }, 'POST /x/disconnect error');
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /status
// ─────────────────────────────────────────────────────────────────────────────

router.get('/status', statusLimiter, requireXOAuth, async (req, res) => {
  try {
    const link = await resolveAuth(req);
    if (!link) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const primaryId = link.primaryId;

    const player = await Player.findOne({ wallet: primaryId }).select('xUserId xUsername xConnectedAt').lean();
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    return res.json({
      connected: Boolean(player.xUserId),
      username: player.xUsername || null,
      connectedAt: player.xConnectedAt ? player.xConnectedAt.toISOString() : null
    });
  } catch (err) {
    logger.error({ err: err.message }, 'GET /x/status error');
    return res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /share-result
// Publish share result as a real post via connected X account.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/share-result', shareResultLimiter, requireXOAuth, async (req, res) => {
  let tokenToUse = '';
  let tweetText = '';
  let player = null;
  try {
    const link = await resolveAuth(req);
    if (!link) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const primaryId = link.primaryId;
    player = await Player.findOne({ wallet: primaryId }).select('+xAccessToken +xRefreshToken');
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    if (!player.xAccessToken) {
      return res.status(400).json({ error: 'x_not_connected' });
    }

    const scoreForShare = player.bestScore || 0;
    const referralUrl = buildReferralUrl(player.referralCode || '', req);
    const postText = buildSharePostText(scoreForShare, referralUrl);
    const walletAddress = link.wallet || null;
    const sharePageUrl = walletAddress
      ? `${getPublicBaseUrl(req)}/api/leaderboard/share/page/${walletAddress}`
      : null;
    tweetText = sharePageUrl ? `${postText}\n${sharePageUrl}` : postText;
    const shareImageBuffer = await loadStaticShareImagePng();

    tokenToUse = player.xAccessToken;
    let tweet;
    try {
      const mediaId = await xOAuth.uploadMedia(tokenToUse, shareImageBuffer);
      if (!mediaId) {
        logger.warn({ primaryId: maskedPrimaryId(primaryId) }, 'X media upload returned empty media id');
        const noMediaErr = new Error('x_media_upload_failed');
        noMediaErr.response = { status: 422, data: { detail: 'empty media id' } };
        throw noMediaErr;
      }
      tweet = await xOAuth.createTweet(tokenToUse, {
        text: tweetText,
        media: { media_ids: [mediaId] }
      });
    } catch (err) {
      if (err?.response?.status !== 401 || !player.xRefreshToken) {
        throw err;
      }

      const refreshed = await xOAuth.refreshAccessToken(player.xRefreshToken);
      tokenToUse = refreshed.access_token || '';
      player.xAccessToken = tokenToUse || null;
      if (refreshed.refresh_token) {
        player.xRefreshToken = refreshed.refresh_token;
      }
      await player.save();

      const mediaId = await xOAuth.uploadMedia(tokenToUse, shareImageBuffer);
      if (!mediaId) {
        logger.warn({ primaryId: maskedPrimaryId(primaryId) }, 'X media upload returned empty media id');
        const noMediaErr = new Error('x_media_upload_failed');
        noMediaErr.response = { status: 422, data: { detail: 'empty media id' } };
        throw noMediaErr;
      }
      tweet = await xOAuth.createTweet(tokenToUse, {
        text: tweetText,
        media: { media_ids: [mediaId] }
      });
    }

    if (!tweet?.id) {
      return res.status(502).json({ error: 'x_post_failed', retryable: true, fallback: 'text_intent' });
    }

    const tweetUrl = player.xUsername
      ? `https://x.com/${player.xUsername}/status/${tweet.id}`
      : `https://x.com/i/web/status/${tweet.id}`;

    return res.json({
      posted: true,
      tweetId: tweet.id,
      tweetUrl,
      text: tweet.text || tweetText
    });
  } catch (err) {
    if (err?.code === 'share_png_unavailable') {
      return res.status(503).json({ error: 'share_png_unavailable' });
    }
    const mapped = classifyShareResultError(err);

    const upstream = extractUpstreamError(err);
    logger.error({ err: err.message, ...upstream }, 'POST /x/share-result error');
    return res.status(mapped.statusCode).json({ error: mapped.error, retryable: mapped.retryable, fallback: mapped.fallback, ...upstream });
  }
});

module.exports = router;
