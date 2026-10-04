// Tests for src/telephony/twilioWebhook.js — the TwiML returned to Twilio.
// Regression for the first real call: Twilio's <Stream> url does NOT support query
// strings, so the auth token must travel as a <Parameter>, never as ?token=.
// Pure function with a fake request/reply: no network, no WebSocket.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { handleIncomingCall } from '../src/telephony/twilioWebhook.js';
import { _reset } from '../src/telephony/callLimiter.js';
import { config } from '../src/config/index.js';

function fakeReply() {
  return {
    statusCode: 200,
    code(c) {
      this.statusCode = c;
      return this;
    },
    header() {
      return this;
    },
    send(body) {
      return body;
    },
  };
}

describe('handleIncomingCall TwiML', () => {
  let original;

  beforeEach(() => {
    original = { security: { ...config.security }, publicUrl: config.publicUrl };
    config.security.validateTwilioSignature = false;
    config.security.streamTokenSecret = 'test-secret';
    config.publicUrl = 'https://example.test';
    _reset();
  });

  afterEach(() => {
    Object.assign(config.security, original.security);
    config.publicUrl = original.publicUrl;
    _reset();
  });

  test('the Stream url has no query string', () => {
    const xml = handleIncomingCall({ headers: {}, body: { From: '+34600000000' } }, fakeReply());
    assert.match(xml, /<Stream url="wss:\/\/example\.test\/media-stream">/);
    assert.doesNotMatch(xml, /media-stream\?/);
  });

  test('the token and the caller number are sent as Parameters', () => {
    const xml = handleIncomingCall({ headers: {}, body: { From: '+34600000000' } }, fakeReply());
    assert.match(xml, /<Parameter name="token" value="[^"]+"\/>/);
    assert.match(xml, /<Parameter name="from" value="\+34600000000"\/>/);
  });

  test('with no secret configured, no token Parameter is sent (dev)', () => {
    config.security.streamTokenSecret = '';
    const xml = handleIncomingCall({ headers: {}, body: {} }, fakeReply());
    assert.doesNotMatch(xml, /name="token"/);
  });
});
