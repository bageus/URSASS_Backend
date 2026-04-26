/**
 * X (Twitter) OAuth 2.0 PKCE utilities.
 *
 * Environment variables consumed:
 *   X_OAUTH_CLIENT_ID       – OAuth 2.0 Client ID from X Developer Portal
 *   X_OAUTH_CLIENT_SECRET   – Client Secret (omit or set X_OAUTH_PUBLIC_CLIENT=true for public clients)
 *   X_OAUTH_PUBLIC_CLIENT   – "true" → skip Basic auth on token exchange
 *   X_OAUTH_REDIRECT_URI    – e.g. https://api.ursasstube.fun/api/x/oauth/callback
 *   X_OAUTH_SCOPES          – default "tweet.read users.read offline.access"
 */

const crypto = require('crypto');
const axios = require('axios');
const logger = require('./logger');

const X_AUTHORIZE_URL = 'https://twitter.com/i/oauth2/authorize';
const X_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const X_USERS_ME_URL = 'https://api.twitter.com/2/users/me';
const X_REVOKE_URL = 'https://api.twitter.com/2/oauth2/revoke';

const HTTP_TIMEOUT_MS = 10_000;

function getClientId() {
  return process.env.X_OAUTH_CLIENT_ID || '';
}

function getClientSecret() {
  return process.env.X_OAUTH_CLIENT_SECRET || '';
}

function isPublicClient() {
  return String(process.env.X_OAUTH_PUBLIC_CLIENT || '').toLowerCase() === 'true';
}

function getRedirectUri() {
  return process.env.X_OAUTH_REDIRECT_URI || '';
}

function getScopes() {
  return process.env.X_OAUTH_SCOPES || 'tweet.read users.read offline.access';
}

/**
 * Generate an RFC 7636 PKCE pair.
 * @returns {{ codeVerifier: string, codeChallenge: string }}
 */
function generatePkcePair() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

/**
 * Build the X OAuth 2.0 authorization URL.
 * @param {{ state: string, codeChallenge: string }} opts
 * @returns {string}
 */
function buildAuthorizeUrl({ state, codeChallenge }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    scope: getScopes(),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });
  return `${X_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Build Basic auth header for confidential clients.
 */
function buildBasicAuth() {
  const encoded = Buffer.from(`${getClientId()}:${getClientSecret()}`).toString('base64');
  return `Basic ${encoded}`;
}

/**
 * Exchange an authorization code for tokens.
 * @param {{ code: string, codeVerifier: string }} opts
 * @returns {Promise<{ access_token, refresh_token, expires_in, scope, token_type }>}
 */
async function exchangeCodeForToken({ code, codeVerifier }) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(),
    code_verifier: codeVerifier,
    client_id: getClientId()
  });

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (!isPublicClient()) {
    headers['Authorization'] = buildBasicAuth();
  }

  const response = await axios.post(X_TOKEN_URL, params.toString(), {
    headers,
    timeout: HTTP_TIMEOUT_MS
  });

  logger.info({ scope: response.data?.scope }, 'X token exchange successful');
  return response.data;
}

/**
 * Refresh an access token using a refresh token.
 * @param {string} refreshToken
 * @returns {Promise<{ access_token, refresh_token, expires_in, scope, token_type }>}
 */
async function refreshAccessToken(refreshToken) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: getClientId()
  });

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (!isPublicClient()) {
    headers['Authorization'] = buildBasicAuth();
  }

  const response = await axios.post(X_TOKEN_URL, params.toString(), {
    headers,
    timeout: HTTP_TIMEOUT_MS
  });

  logger.info('X token refresh successful');
  return response.data;
}

/**
 * Fetch the authenticated X user's basic profile.
 * @param {string} accessToken
 * @returns {Promise<{ id: string, username: string }>}
 */
async function fetchXUser(accessToken) {
  const response = await axios.get(`${X_USERS_ME_URL}?user.fields=username,id`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: HTTP_TIMEOUT_MS
  });
  const { id, username } = response.data?.data || {};
  return { id, username };
}

/**
 * Revoke a token (access or refresh) via X API.
 * Best-effort: logs errors but does not throw.
 * @param {string} token
 * @returns {Promise<void>}
 */
async function revokeToken(token) {
  try {
    const params = new URLSearchParams({ token, client_id: getClientId() });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (!isPublicClient()) {
      headers['Authorization'] = buildBasicAuth();
    }

    await axios.post(X_REVOKE_URL, params.toString(), {
      headers,
      timeout: HTTP_TIMEOUT_MS
    });
    logger.info('X token revoked');
  } catch (err) {
    logger.warn({ err: err.message }, 'X token revoke failed (best-effort, ignored)');
  }
}

/**
 * Returns true if X OAuth is configured (client ID and redirect URI are set).
 */
function isXOAuthConfigured() {
  return Boolean(getClientId() && getRedirectUri());
}

module.exports = {
  generatePkcePair,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshAccessToken,
  fetchXUser,
  revokeToken,
  isXOAuthConfigured
};
