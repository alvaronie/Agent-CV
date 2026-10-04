// Tests for src/telephony/farewell.js — spoken goodbye before a limit-triggered hangup.
// All dependencies and timers are fakes: no network, no WebSocket, no real waiting.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createFarewell,
  FAREWELL_TAG,
  FAREWELL_MARK,
  FAREWELL_INSTRUCTIONS,
} from '../src/telephony/farewell.js';

function makeHarness({ sayResult = true } = {}) {
  const h = { said: [], sent: [], hangups: 0, timerFn: null, cleared: 0 };
  h.farewell = createFarewell({
    say: (instructions, tag) => {
      h.said.push({ instructions, tag });
      return sayResult;
    },
    sendToTwilio: (msg) => h.sent.push(msg),
    hangUp: () => (h.hangups += 1),
    timeoutMs: 15000,
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

describe('createFarewell', () => {
  let h;

  beforeEach(() => {
    h = makeHarness();
  });

  test('begin clears queued audio and asks the model to say the farewell', () => {
    assert.equal(h.farewell.begin('max_duration'), true);
    assert.deepEqual(h.sent[0], { event: 'clear' });
    assert.equal(h.said.length, 1);
    assert.equal(h.said[0].tag, FAREWELL_TAG);
    assert.equal(h.said[0].instructions, FAREWELL_INSTRUCTIONS.max_duration);
    assert.equal(h.farewell.isEnding(), true);
    assert.equal(h.hangups, 0, 'must not hang up before the goodbye plays');
  });

  test('completed farewell response -> sends a mark; the echoed mark hangs up once', () => {
    h.farewell.begin('silence');
    h.farewell.onResponseDone({ status: 'completed' }, FAREWELL_TAG);
    assert.deepEqual(h.sent.at(-1), { event: 'mark', mark: { name: FAREWELL_MARK } });
    assert.equal(h.hangups, 0);

    h.farewell.onMark(FAREWELL_MARK);
    h.farewell.onMark(FAREWELL_MARK);
    assert.equal(h.hangups, 1);
  });

  test('responses without the farewell tag are ignored (e.g. the cancelled answer)', () => {
    h.farewell.begin('max_turns');
    h.farewell.onResponseDone({ status: 'completed' }, null);
    h.farewell.onResponseDone({ status: 'cancelled' }, null);
    assert.equal(h.sent.filter((m) => m.event === 'mark').length, 0);
    assert.equal(h.hangups, 0);
  });

  test('a failed farewell response hangs up right away', () => {
    h.farewell.begin('silence');
    h.farewell.onResponseDone({ status: 'failed' }, FAREWELL_TAG);
    assert.equal(h.hangups, 1);
  });

  test('if the model cannot speak, it hangs up immediately', () => {
    h = makeHarness({ sayResult: false });
    h.farewell.begin('max_duration');
    assert.equal(h.hangups, 1);
  });

  test('fallback timer hangs up if the mark never comes back', () => {
    h.farewell.begin('max_duration');
    h.timerFn();
    assert.equal(h.hangups, 1);
  });

  test('a second begin is ignored', () => {
    h.farewell.begin('silence');
    assert.equal(h.farewell.begin('max_duration'), false);
    assert.equal(h.said.length, 1);
  });

  test('stop() cancels the fallback without hanging up', () => {
    h.farewell.begin('silence');
    h.farewell.stop();
    assert.equal(h.cleared, 1);
    assert.equal(h.hangups, 0);
  });

  test('unknown reason: no speech, hang up', () => {
    h.farewell.begin('nope');
    assert.equal(h.said.length, 0);
    assert.equal(h.hangups, 1);
  });

  test('each farewell states its reason and keeps the Spain-Spanish rule', () => {
    assert.match(FAREWELL_INSTRUCTIONS.max_duration, /maximum call time/);
    assert.match(FAREWELL_INSTRUCTIONS.silence, /haven't heard from them/);
    assert.match(FAREWELL_INSTRUCTIONS.max_turns, /maximum length allowed/);
    for (const text of Object.values(FAREWELL_INSTRUCTIONS)) {
      assert.match(text, /European Spanish from Spain/);
      assert.match(text, /do not call any tools/);
    }
  });
});
