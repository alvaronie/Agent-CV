// Tests for the transfer flow: transfer TwiML (transferCall.js) and the <Dial> action
// callback (transferStatus.js). Pure functions and fake request/reply: no network.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildTransferTwiml } from '../src/agent/tools/transferCall.js';
import {
  buildTransferStatusTwiml,
  handleTransferStatus,
} from '../src/telephony/transferStatus.js';
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
      this.body = body;
      return body;
    },
  };
}

describe('buildTransferTwiml', () => {
  test('dials the personal number with an absolute action URL and the call language', () => {
    const xml = buildTransferTwiml({
      personalNumber: '+34600000000',
      callerId: '+35227649546',
      publicUrl: 'https://agent-cv.onrender.com/',
      language: 'es',
    });
    assert.match(xml, /<Number>\+34600000000<\/Number>/);
    assert.match(xml, /callerId="\+35227649546"/);
    assert.match(
      xml,
      /action="https:\/\/agent-cv\.onrender\.com\/transfer-status\?lang=es"/
    );
    assert.match(xml, /method="POST"/);
    assert.match(xml, /timeout="25"/);
  });

  test('unknown language falls back to English', () => {
    const xml = buildTransferTwiml({
      personalNumber: '+34600000000',
      publicUrl: 'https://example.test',
      language: 'fr',
    });
    assert.match(xml, /transfer-status\?lang=en/);
  });

  test('without a public URL there is no action (cannot be resolved)', () => {
    const xml = buildTransferTwiml({ personalNumber: '+34600000000' });
    assert.doesNotMatch(xml, /action=/);
  });
});

describe('buildTransferStatusTwiml', () => {
  test('regression: a blocked transfer apologizes in Spanish instead of dropping', () => {
    // Real calls: DialCallStatus=failed (Twilio 13227, geo permissions) cut the call dead.
    const xml = buildTransferStatusTwiml('failed', 'es');
    assert.match(xml, /<Say language="es-ES">Lo siento/);
    assert.match(xml, /<Hangup\/>/);
  });

  test('no-answer and busy also apologize; English by default', () => {
    for (const status of ['no-answer', 'busy', 'canceled']) {
      const xml = buildTransferStatusTwiml(status);
      assert.match(xml, /<Say language="en-US">Sorry, I couldn't reach Álvaro/);
    }
  });

  test('a connected call just hangs up, no apology', () => {
    const xml = buildTransferStatusTwiml('completed', 'es');
    assert.doesNotMatch(xml, /<Say/);
    assert.match(xml, /<Hangup\/>/);
  });
});

describe('handleTransferStatus', () => {
  let original;

  beforeEach(() => {
    original = { ...config.security };
  });

  afterEach(() => {
    Object.assign(config.security, original);
  });

  test('rejects unsigned requests with 403', () => {
    config.security.validateTwilioSignature = true;
    const reply = fakeReply();
    handleTransferStatus(
      { url: '/transfer-status?lang=es', headers: {}, body: { DialCallStatus: 'failed' }, query: { lang: 'es' } },
      reply
    );
    assert.equal(reply.statusCode, 403);
    assert.equal(reply.body, 'Forbidden');
  });

  test('returns the apology TwiML for a failed transfer', () => {
    config.security.validateTwilioSignature = false;
    const reply = fakeReply();
    const xml = handleTransferStatus(
      { headers: {}, body: { DialCallStatus: 'failed' }, query: { lang: 'es' } },
      reply
    );
    assert.match(xml, /Lo siento/);
  });
});
