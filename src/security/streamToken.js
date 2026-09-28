// Single-use, short-lived token to authenticate the /media-stream WebSocket.
//
// Problem: /media-stream is a public WebSocket. Without protection, anyone who discovers
// the URL could open it and force us to connect to OpenAI (burning tokens). Twilio, on
// the other hand, only knows the URL because we hand it over in the webhook TwiML (which
// is itself protected by the Twilio signature, see twilioSignature.js).
//
// Solution: when generating the TwiML we embed a token in the <Stream> URL, signed with
// HMAC-SHA256 and with an expiry. When the WebSocket opens, we verify the token BEFORE
// connecting to OpenAI. The token needs no server-side state: the signature and the
// expiry timestamp are self-validating (stateless).
//
// Token format:  base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload))
// Payload: { exp: <epoch in seconds> }
//
// If `STREAM_TOKEN_SECRET` is not configured, verification is DISABLED (for local
// development): createStreamToken() returns null and verifyStreamToken() accepts. In
// production the secret must be set so the protection is active.

import crypto from 'node:crypto';
import { config } from '../config/index.js';

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

/**
 * Creates a signed token with an expiry. Returns null if no secret is configured
 * (protection disabled in dev).
 * @param {number} [now] epoch in ms (injectable for tests)
 * @returns {string|null}
 */
export function createStreamToken(now = Date.now()) {
  const { streamTokenSecret, streamTokenTtlSeconds } = config.security;
  if (!streamTokenSecret) return null;

  const payload = { exp: Math.floor(now / 1000) + streamTokenTtlSeconds };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${sign(data, streamTokenSecret)}`;
}

/**
 * Verifies a stream token.
 * @param {string|undefined} token
 * @param {number} [now] epoch in ms (injectable for tests)
 * @returns {{valid: boolean, reason?: string}}
 */
export function verifyStreamToken(token, now = Date.now()) {
  const { streamTokenSecret } = config.security;
  // No secret: protection disabled (dev). We accept but flag it.
  if (!streamTokenSecret) return { valid: true, reason: 'disabled' };

  if (!token || typeof token !== 'string') return { valid: false, reason: 'missing' };

  const [data, sig] = token.split('.');
  if (!data || !sig) return { valid: false, reason: 'malformed' };

  // Constant-time comparison so we don't leak information through timing.
  const expected = sign(data, streamTokenSecret);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'bad-signature' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'bad-payload' };
  }

  if (typeof payload.exp !== 'number' || Math.floor(now / 1000) > payload.exp) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true };
}
