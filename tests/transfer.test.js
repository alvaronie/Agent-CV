// Tests for the transfer flow: transfer TwiML (transferCall.js) and the <Dial> action
// callback (transferStatus.js). Pure functions and fakes: no network, no WebSocket.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { buildTransferTwiml } from '../src/agent/tools/transferCall.js';
import { createTransferStatusHandler } from '../src/telephony/transferStatus.js';
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

function fakeSessions() {
  const log = { outcomes: [], finalized: [] };
  return {
    log,
    recordTransferOutcome: (sid, status) => log.outcomes.push({ sid, status }),
    finalizeLater: (sid) => log.finalized.push(sid),
    get: () => ({ from: '+34611111111' }),
  };
}

function request(body, lang = 'es') {
  return { url: `/transfer-status?lang=${lang}`, headers: {}, body, query: { lang } };
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
    assert.match(xml, /action="https:\/\/agent-cv\.onrender\.com\/transfer-status\?lang=es"/);
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

describe('transfer-status handler', () => {
  let original;
  let sessions;
  let handle;

  beforeEach(() => {
    original = { security: { ...config.security }, publicUrl: config.publicUrl };
    config.security.validateTwilioSignature = false;
    config.security.streamTokenSecret = 'test-secret';
    config.publicUrl = 'https://agent-cv.onrender.com';
    sessions = fakeSessions();
    handle = createTransferStatusHandler({ sessions });
  });

  afterEach(() => {
    Object.assign(config.security, original.security);
    config.publicUrl = original.publicUrl;
  });

  test('no answer, caller still on the line: back to the agent (resume stream)', () => {
    for (const status of ['no-answer', 'busy', 'failed', 'canceled']) {
      const xml = handle(
        request({ CallSid: 'CA1', DialCallStatus: status, CallStatus: 'in-progress', From: '+34611111111' }),
        fakeReply()
      );
      assert.match(xml, /<Connect><Stream url="wss:\/\/agent-cv\.onrender\.com\/media-stream">/);
      assert.match(xml, /<Parameter name="token" value="[^"]+"\/>/);
      assert.match(xml, /<Parameter name="resume" value="1"\/>/);
      assert.match(xml, /<Parameter name="lang" value="es"\/>/);
      assert.match(xml, /<Parameter name="from" value="\+34611111111"\/>/);
      assert.doesNotMatch(xml, /<Hangup/);
    }
    assert.equal(sessions.log.finalized.length, 0, 'the call is not over yet');
    assert.equal(sessions.log.outcomes.length, 4, 'each outcome goes into the transcript');
  });

  test('Álvaro answered: hang up and summarize the call', () => {
    const xml = handle(
      request({ CallSid: 'CA1', DialCallStatus: 'completed', CallStatus: 'in-progress' }),
      fakeReply()
    );
    assert.match(xml, /<Hangup\/>/);
    assert.deepEqual(sessions.log.finalized, ['CA1']);
  });

  test('the caller hung up while it was ringing: summarize, do not resume', () => {
    const xml = handle(
      request({ CallSid: 'CA1', DialCallStatus: 'no-answer', CallStatus: 'completed' }),
      fakeReply()
    );
    assert.match(xml, /<Hangup\/>/);
    assert.doesNotMatch(xml, /<Stream/);
    assert.deepEqual(sessions.log.finalized, ['CA1']);
  });

  test('rejects unsigned requests with 403', () => {
    config.security.validateTwilioSignature = true;
    const reply = fakeReply();
    handle(request({ CallSid: 'CA1', DialCallStatus: 'no-answer' }), reply);
    assert.equal(reply.statusCode, 403);
    assert.equal(sessions.log.outcomes.length, 0);
  });
});
