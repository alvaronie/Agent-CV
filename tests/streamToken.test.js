// Tests for src/security/streamToken.js — HMAC token with expiry for /media-stream.
// No network or external state: all local computation with a test secret.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createStreamToken, verifyStreamToken } from '../src/security/streamToken.js';
import { config } from '../src/config/index.js';

describe('streamToken', () => {
  let original;

  beforeEach(() => {
    original = { ...config.security };
    config.security.streamTokenSecret = 'test-secret';
    config.security.streamTokenTtlSeconds = 300;
  });

  afterEach(() => {
    Object.assign(config.security, original);
  });

  test('a freshly created token verifies as valid', () => {
    const token = createStreamToken();
    assert.equal(typeof token, 'string');
    assert.equal(verifyStreamToken(token).valid, true);
  });

  test('a missing or empty token is invalid', () => {
    assert.deepEqual(verifyStreamToken(undefined), { valid: false, reason: 'missing' });
    assert.deepEqual(verifyStreamToken(''), { valid: false, reason: 'missing' });
  });

  test('a malformed token is invalid', () => {
    assert.deepEqual(verifyStreamToken('nodot'), { valid: false, reason: 'malformed' });
  });

  test('a tampered signature is invalid', () => {
    const token = createStreamToken();
    const [data] = token.split('.');
    const tampered = `${data}.fakesignature`;
    assert.equal(verifyStreamToken(tampered).valid, false);
  });

  test('a tampered payload (same signature) does not pass', () => {
    const token = createStreamToken();
    const [, sig] = token.split('.');
    // Change the payload but keep the old signature: the signature check must fail.
    const otherData = Buffer.from(JSON.stringify({ exp: 9999999999 })).toString('base64url');
    assert.equal(verifyStreamToken(`${otherData}.${sig}`).valid, false);
  });

  test('an expired token is invalid', () => {
    // Created at a much earlier instant; already expired relative to "now".
    const past = Date.now() - 10 * 60 * 1000; // 10 min ago
    const token = createStreamToken(past);
    const result = verifyStreamToken(token);
    assert.deepEqual(result, { valid: false, reason: 'expired' });
  });

  test('with no secret configured, verification is disabled (dev)', () => {
    config.security.streamTokenSecret = '';
    assert.equal(createStreamToken(), null);
    assert.deepEqual(verifyStreamToken(undefined), { valid: true, reason: 'disabled' });
  });

  test('a token signed with a different secret is not accepted', () => {
    const token = createStreamToken();
    config.security.streamTokenSecret = 'another-different-secret';
    assert.equal(verifyStreamToken(token).valid, false);
  });
});
