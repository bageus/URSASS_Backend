const crypto = require('crypto');

const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || 7 * 24 * 60 * 60);

function getSessionSecret() {
  const secret = String(process.env.SESSION_SECRET || process.env.JWT_SECRET || '').trim();
  if (!secret) throw new Error('SESSION_SECRET_OR_JWT_SECRET_MISSING');
  return secret;
}

function base64urlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function base64urlDecode(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signRaw(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

function signSessionToken(payload) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SESSION_TTL_SECONDS;
  const fullPayload = { ...payload, iat: now, exp };
  const encoded = base64urlEncode(JSON.stringify(fullPayload));
  const signature = signRaw(encoded, getSessionSecret());
  return `${encoded}.${signature}`;
}

function verifySessionToken(token) {
  const [encoded, signature] = String(token || '').split('.');
  if (!encoded || !signature) throw new Error('INVALID_TOKEN_FORMAT');
  const expected = signRaw(encoded, getSessionSecret());
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error('INVALID_TOKEN_SIGNATURE');
  const decoded = JSON.parse(base64urlDecode(encoded));
  const now = Math.floor(Date.now() / 1000);
  if (!decoded.exp || now >= decoded.exp) throw new Error('TOKEN_EXPIRED');
  return decoded;
}

module.exports = { SESSION_TTL_SECONDS, signSessionToken, verifySessionToken };
