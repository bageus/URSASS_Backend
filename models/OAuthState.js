const mongoose = require('mongoose');

/**
 * Temporary store for OAuth 2.0 PKCE state between /oauth/start and /oauth/callback.
 * Documents are auto-deleted after 5 minutes via MongoDB TTL index.
 */
const oauthStateSchema = new mongoose.Schema({
  state: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  primaryId: {
    type: String,
    required: true
  },
  codeVerifier: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 300 // TTL: auto-delete after 5 minutes
  }
});

module.exports = mongoose.model('OAuthState', oauthStateSchema);
