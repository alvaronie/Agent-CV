// Tests for the auth gate in src/telephony/mediaStream.js.
//
// Uses an in-memory fake WebSocket (EventEmitter): no real socket is opened. Only the
// REJECTION paths are exercised, so the code never reaches connectRealtime() — a valid
// token would open a real connection to OpenAI, which these tests must never do.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { handleMediaStream } from '../src/telephony/mediaStream.js';
import { _reset, _snapshot } from '../src/telephony/callLimiter.js';
import { config } from '../src/config/index.js';

function fakeWs() {
  const ws = new EventEmitter();
  ws.closedWith = null;
  ws.sent = [];
  ws.send = (data) => ws.sent.push(data);
  ws.close = (code, reason) => {
    if (ws.closedWith) return;
    ws.closedWith = { code, reason };
    ws.emit('close');
  };
  return ws;
}

function startEvent(customParameters) {
  return Buffer.from(
    JSON.stringify({
      event: 'start',
      start: { streamSid: 'MZtest', callSid: 'CAtest', customParameters },
    })
  );
}

describe('mediaStream auth gate', () => {
  let original;

  beforeEach(() => {
    original = { ...config.security };
    // A secret MUST be set: with no secret the gate is disabled (dev) and a start event
    // would open a real OpenAI connection.
    config.security.streamTokenSecret = 'test-secret';
    _reset();
  });

  afterEach(() => {
    Object.assign(config.security, original);
    _reset();
  });

  test('a start event without a token is rejected with 1008', () => {
    const ws = fakeWs();
    handleMediaStream(ws);
    ws.emit('message', startEvent({ from: '+34600000000' }));
    assert.deepEqual(ws.closedWith, { code: 1008, reason: 'unauthorized' });
  });

  test('a start event with a forged token is rejected with 1008', () => {
    const ws = fakeWs();
    handleMediaStream(ws);
    ws.emit('message', startEvent({ token: 'forged.token' }));
    assert.deepEqual(ws.closedWith, { code: 1008, reason: 'unauthorized' });
  });

  test('a rejected stream is not counted as a call', () => {
    const ws = fakeWs();
    handleMediaStream(ws);
    ws.emit('message', startEvent({}));
    assert.equal(_snapshot().callsToday, 0);
    assert.equal(_snapshot().activeCalls, 0);
  });

  test('media before an authorized start is ignored (nothing is sent back)', () => {
    const ws = fakeWs();
    handleMediaStream(ws);
    ws.emit('message', Buffer.from(JSON.stringify({ event: 'media', media: { payload: 'AA==' } })));
    assert.equal(ws.sent.length, 0);
    ws.close(); // clean up the start timer
  });
});
