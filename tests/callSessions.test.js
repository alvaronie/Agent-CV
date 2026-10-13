// Tests for src/telephony/callSessions.js — per-call state across stream legs.
// Injected reportCall/limiter/timers: no network, no WebSocket, no real waiting.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createCallSessions, transferOutcomeText } from '../src/telephony/callSessions.js';

function harness() {
  const h = { reports: [], starts: 0, ends: 0, timerFn: null, cleared: 0 };
  h.sessions = createCallSessions({
    reportCall: async (call) => h.reports.push(call),
    registerCallStart: () => (h.starts += 1),
    registerCallEnd: () => (h.ends += 1),
    setTimer: (fn) => {
      h.timerFn = fn;
      return 1;
    },
    clearTimer: () => {
      h.cleared += 1;
      h.timerFn = null;
    },
  });
  return h;
}

const flush = () => new Promise((r) => setImmediate(r));

describe('callSessions', () => {
  let h;

  beforeEach(() => {
    h = harness();
  });

  test('a normal call is counted once and summarized when its stream closes', async () => {
    const { session, resumed } = h.sessions.begin('CA1', { from: '+34611111111' });
    assert.equal(resumed, false);
    session.transcript.add('caller', 'Hola');
    h.sessions.legClosed('CA1');
    await flush();

    assert.equal(h.starts, 1);
    assert.equal(h.ends, 1);
    assert.equal(h.reports.length, 1);
    assert.deepEqual(h.reports[0].turns, [{ role: 'caller', text: 'Hola' }]);
    assert.equal(h.reports[0].from, '+34611111111');
  });

  test('transfer not answered: ONE email covering both legs, with the outcome', async () => {
    const first = h.sessions.begin('CA1', { from: '+34611111111' }).session;
    first.transcript.add('caller', 'Quiero hablar con Álvaro');
    h.sessions.markTransferring('CA1');
    h.sessions.legClosed('CA1'); // stream closes because of the <Dial>
    await flush();
    assert.equal(h.reports.length, 0, 'no email while it is ringing');

    h.sessions.recordTransferOutcome('CA1', 'no-answer');
    const { session, resumed } = h.sessions.begin('CA1', { from: '+34611111111' });
    assert.equal(resumed, true);
    assert.equal(session, first, 'same session, same transcript');
    session.transcript.add('caller', 'Sí, al mismo número');
    h.sessions.legClosed('CA1');
    await flush();

    assert.equal(h.starts, 1, 'the call is counted once');
    assert.equal(h.ends, 1);
    assert.equal(h.reports.length, 1, 'exactly one summary email');
    assert.deepEqual(h.reports[0].turns, [
      { role: 'caller', text: 'Quiero hablar con Álvaro' },
      { role: 'event', text: transferOutcomeText('no-answer') },
      { role: 'caller', text: 'Sí, al mismo número' },
    ]);
  });

  test('resuming cancels the safety-net timer', () => {
    h.sessions.begin('CA1');
    h.sessions.markTransferring('CA1');
    h.sessions.legClosed('CA1');
    assert.ok(h.timerFn, 'safety net armed');
    h.sessions.begin('CA1');
    assert.equal(h.timerFn, null);
  });

  test('if Twilio never calls back, the safety net still sends the summary', async () => {
    h.sessions.begin('CA1');
    h.sessions.markTransferring('CA1');
    h.sessions.legClosed('CA1');
    h.timerFn();
    await flush();
    assert.equal(h.reports.length, 1);
  });

  test('finalize is idempotent', async () => {
    h.sessions.begin('CA1');
    await h.sessions.finalize('CA1');
    await h.sessions.finalize('CA1');
    h.sessions.legClosed('CA1');
    await flush();
    assert.equal(h.reports.length, 1);
    assert.equal(h.ends, 1);
    assert.equal(h.sessions._size(), 0);
  });

  test('a failed transfer request keeps the call with the agent', async () => {
    h.sessions.begin('CA1');
    h.sessions.markTransferring('CA1');
    h.sessions.cancelTransfer('CA1');
    h.sessions.legClosed('CA1');
    await flush();
    assert.equal(h.reports.length, 1, 'closing now is the real end of the call');
  });

  test('outcome texts (Spanish, they go into the summary)', () => {
    assert.match(transferOutcomeText('no-answer'), /no contestó/);
    assert.match(transferOutcomeText('busy'), /comunicando o rechazó/);
    assert.match(transferOutcomeText('completed'), /hablaron directamente/);
    assert.match(transferOutcomeText('weird'), /no fue posible contactar/);
  });
});
