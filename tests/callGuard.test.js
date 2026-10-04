// Tests for src/telephony/callGuard.js — mutual-silence timeout and max caller turns.
// Injected timers: no network, WebSocket or real waiting.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createCallGuard } from '../src/telephony/callGuard.js';

// Controllable fake timer: stores the pending callback and lets us fire it by hand.
function fakeTimers() {
  let pending = null;
  return {
    set: (fn) => {
      pending = fn;
      return 1;
    },
    clear: () => {
      pending = null;
    },
    fire: () => {
      const fn = pending;
      pending = null;
      if (fn) fn();
    },
    hasPending: () => pending !== null,
  };
}

describe('createCallGuard', () => {
  let timers;
  let fired;

  beforeEach(() => {
    timers = fakeTimers();
    fired = 0;
  });

  function makeGuard(overrides = {}) {
    return createCallGuard({
      silenceMs: 20000,
      maxCallerTurns: 3,
      onSilence: () => (fired += 1),
      setTimer: timers.set,
      clearTimer: timers.clear,
      ...overrides,
    });
  }

  test('start() arms the silence timer (nobody is speaking yet)', () => {
    const guard = makeGuard();
    guard.start();
    assert.equal(guard._state().armed, true);
  });

  test('when the timer elapses with both quiet, it calls onSilence', () => {
    const guard = makeGuard();
    guard.start();
    timers.fire();
    assert.equal(fired, 1);
  });

  test('regression: a long agent answer does not count as silence', () => {
    // OpenAI streams a 20 s answer in ~2 s. The timer must stay off until Twilio
    // confirms playback ended (agentDone), however long that takes.
    const guard = makeGuard();
    guard.start();
    guard.agentAudio();
    assert.equal(guard._state().armed, false);
    assert.equal(timers.hasPending(), false);

    guard.agentDone(); // playback finished
    assert.equal(guard._state().armed, true);
    assert.equal(fired, 0);
  });

  test('the timer stays off while the caller is speaking', () => {
    const guard = makeGuard();
    guard.start();
    guard.callerSpeechStarted();
    assert.equal(guard._state().armed, false);
    guard.callerSpeechStopped();
    assert.equal(guard._state().armed, true);
  });

  test('barge-in: the agent finishing while the caller talks does not arm it', () => {
    const guard = makeGuard();
    guard.start();
    guard.agentAudio();
    guard.callerSpeechStarted();
    guard.agentDone(); // Twilio echoes the mark when we clear the buffer
    assert.equal(guard._state().armed, false);
    guard.callerSpeechStopped();
    assert.equal(guard._state().armed, true);
  });

  test('each new quiet period restarts the countdown from zero', () => {
    let arms = 0;
    const guard = makeGuard({
      setTimer: (fn) => {
        arms += 1;
        return timers.set(fn);
      },
    });
    guard.start(); // 1
    guard.agentAudio();
    guard.agentDone(); // 2
    guard.callerSpeechStarted();
    guard.callerSpeechStopped(); // 3
    assert.equal(arms, 3);
  });

  test('countCallerTurn returns true and notifies when the maximum is reached', () => {
    let maxed = 0;
    const guard = makeGuard({ onMaxTurns: () => (maxed += 1) });
    assert.equal(guard.countCallerTurn(), false); // 1
    assert.equal(guard.countCallerTurn(), false); // 2
    assert.equal(guard.countCallerTurn(), true); // 3 -> limit
    assert.equal(maxed, 1);
    assert.equal(guard._state().callerTurns, 3);
  });

  test('stop() cancels the timer and prevents later triggers', () => {
    const guard = makeGuard();
    guard.start();
    guard.stop();
    assert.equal(guard._state().armed, false);
    guard.agentDone(); // must not re-arm after stop
    assert.equal(guard._state().armed, false);
    timers.fire();
    assert.equal(fired, 0);
  });

  test('silenceMs=0 disables the silence timeout', () => {
    const guard = makeGuard({ silenceMs: 0 });
    guard.start();
    guard.agentDone();
    assert.equal(guard._state().armed, false);
  });

  test('maxCallerTurns=0 disables the turn limit', () => {
    const guard = makeGuard({ maxCallerTurns: 0 });
    for (let i = 0; i < 10; i += 1) assert.equal(guard.countCallerTurn(), false);
  });
});
