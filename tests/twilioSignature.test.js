// Tests for src/security/twilioSignature.js — X-Twilio-Signature validation.
//
// We generate valid signatures with the SAME algorithm documented by Twilio (HMAC-SHA1
// over url + sorted params, base64) to check that our wrapper builds the URL and passes
// the parameters correctly. No network.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { isValidTwilioRequest, buildRequestUrl } from '../src/security/twilioSignature.js';
import { config } from '../src/config/index.js';

const AUTH_TOKEN = 'test-token';
const PUBLIC_URL = 'https://example.ngrok.app';

// Signs a request the way Twilio would (official algorithm for POST).
function twilioSign(authToken, url, params) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

function makeRequest({ url = '/incoming-call', body = {}, signature } = {}) {
  return {
    url,
    headers: signature ? { 'x-twilio-signature': signature } : {},
    body,
  };
}

describe('isValidTwilioRequest', () => {
  let original;

  beforeEach(() => {
    original = { twilio: { ...config.twilio }, publicUrl: config.publicUrl };
    config.twilio.authToken = AUTH_TOKEN;
    config.publicUrl = PUBLIC_URL;
  });

  afterEach(() => {
    Object.assign(config.twilio, original.twilio);
    config.publicUrl = original.publicUrl;
  });

  test('accepts a correctly signed request', () => {
    const body = { From: '+34600000000', To: '+35227642973', CallSid: 'CA123' };
    const signature = twilioSign(AUTH_TOKEN, `${PUBLIC_URL}/incoming-call`, body);
    assert.equal(isValidTwilioRequest(makeRequest({ body, signature })), true);
  });

  test('rejects when the signature header is missing', () => {
    const body = { From: '+34600000000' };
    assert.equal(isValidTwilioRequest(makeRequest({ body })), false);
  });

  test('rejects an incorrect signature', () => {
    const body = { From: '+34600000000' };
    assert.equal(
      isValidTwilioRequest(makeRequest({ body, signature: 'invalid-signature' })),
      false
    );
  });

  test('rejects if the body changes from what was signed (anti-tamper)', () => {
    const body = { From: '+34600000000', CallSid: 'CA123' };
    const signature = twilioSign(AUTH_TOKEN, `${PUBLIC_URL}/incoming-call`, body);
    const tampered = { ...body, From: '+34699999999' };
    assert.equal(isValidTwilioRequest(makeRequest({ body: tampered, signature })), false);
  });

  test('without an Auth Token it cannot verify: returns false', () => {
    config.twilio.authToken = '';
    const body = { From: '+34600000000' };
    const signature = twilioSign(AUTH_TOKEN, `${PUBLIC_URL}/incoming-call`, body);
    assert.equal(isValidTwilioRequest(makeRequest({ body, signature })), false);
  });

  test('buildRequestUrl uses PUBLIC_URL when defined', () => {
    assert.equal(
      buildRequestUrl({ url: '/incoming-call', headers: {} }),
      `${PUBLIC_URL}/incoming-call`
    );
  });

  test('buildRequestUrl falls back to headers if there is no PUBLIC_URL', () => {
    config.publicUrl = '';
    const url = buildRequestUrl({
      url: '/incoming-call',
      headers: { host: 'localhost:3001', 'x-forwarded-proto': 'https' },
    });
    assert.equal(url, 'https://localhost:3001/incoming-call');
  });
});
