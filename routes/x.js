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
const rateLimit = require('express-rate-limit');
const OAuthState = require('../models/OAuthState');
const Player = require('../models/Player');
const AccountLink = require('../models/AccountLink');
const xOAuth = require('../utils/xOAuth');
const { logSecurityEvent } = require('../utils/security');
const logger = require('../utils/logger');

const FRONTEND_BASE_URL = () => (process.env.FRONTEND_BASE_URL || 'https://ursasstube.fun').replace(/\/+$/, '');

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

/**
 * Resolve authenticated primaryId from request headers.
 * Returns AccountLink if valid, null otherwise.
 */
async function resolveAuth(req) {
  const primaryId = (
    req.get('x-primary-id') ||
    req.get('X-Primary-Id') ||
    req.body?.primaryId ||
    ''
  ).trim().toLowerCase();

  if (!primaryId) return null;

  const link = await AccountLink.findOne({ primaryId });
  if (!link) return null;

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
      logger.warn(
        { xUserId, requestingPrimaryId: primaryId, ownerPrimaryId: existing.wallet },
        'X account already linked to another player'
      );
      await logSecurityEvent({
        wallet: primaryId,
        eventType: 'x_oauth_already_linked',
        route: '/api/x/oauth/callback',
        ipAddress: getClientIp(req),
        details: { xUserId, xUsername }
      });
      await OAuthState.deleteOne({ state: stateStr });
      return res.redirect(302, `${frontendBase}/?x=error&reason=already_linked`);
    }

    // Update player record
    const player = await Player.findOne({ wallet: primaryId }).select('+xAccessToken +xRefreshToken');
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

    const player = await Player.findOne({ wallet: primaryId }).select('+xAccessToken +xRefreshToken');
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

module.exports = router;
