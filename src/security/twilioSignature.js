// Twilio signature validation (`X-Twilio-Signature`) on the /incoming-call webhook.
//
// Twilio signs every webhook request with HMAC-SHA1 over the full URL (plus the form
// fields on a POST), using the account Auth Token as the key. Verifying it prevents a
// third party who discovers the webhook URL from impersonating Twilio and triggering
// calls (and cost). We use the official SDK validator (`twilio.validateRequest`).
//
// URL challenge: the signature is computed over the EXACT URL Twilio called, which
// behind a tunnel/proxy does not match the local host. That's why we prefer `PUBLIC_URL`
// (the real public URL) and, if absent, rebuild it from the proxy headers.

import twilio from 'twilio';
import { config } from '../config/index.js';

/**
 * Rebuilds the absolute URL Twilio used to call the webhook.
 * @param {import('fastify').FastifyRequest} request
 * @returns {string}
 */
export function buildRequestUrl(request) {
  const path = request.url || request.raw?.url || '';
  if (config.publicUrl) {
    return `${config.publicUrl.replace(/\/$/, '')}${path}`;
  }
  const proto =
    request.headers['x-forwarded-proto'] || request.protocol || 'https';
  const host = request.headers['x-forwarded-host'] || request.headers.host || '';
  return `${proto}://${host}${path}`;
}

/**
 * Is the request validly signed by Twilio?
 * Without an Auth Token or a signature header, returns false (cannot be verified).
 * @param {import('fastify').FastifyRequest} request
 * @returns {boolean}
 */
export function isValidTwilioRequest(request) {
  const authToken = config.twilio.authToken;
  if (!authToken) return false;

  const signature = request.headers['x-twilio-signature'];
  if (!signature) return false;

  const url = buildRequestUrl(request);
  const params =
    request.body && typeof request.body === 'object' ? request.body : {};

  return twilio.validateRequest(authToken, signature, url, params);
}
