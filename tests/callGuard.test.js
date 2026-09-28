// Tests for src/telephony/callGuard.js — silence and max caller turns.
// Injected timers: no network, WebSocket or real waiting.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createCallGuard } from '../src/telephony/callGuard.js';

// Controllable fake timer: stores the callback and lets us fire it by hand.
function fakeTimers() {
  let pending = null;
  let nextId = 1;
  return {
    set: (fn, _ms) => {
      pending = fn;
      return nextId++;
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

  beforeEach(() => {
    timers = fakeTimers();
  });

  function makeGuard(overrides = {}) {
    return createCallGuard({
      silenceMs: 20000,
      maxCallerTurns: 3,
      setTimer: timers.set,
      clearTimer: timers.clear,
      ...overrides,
    });
  }

  test('start() arms the silence timer', () => {
    const guard = makeGuard();
    guard.start();
    assert.equal(guard._state().armed, true);
  });

  test('when the silence timeout elapses it calls onSilence', () => {
    let fired = 0;
    const guard = makeGuard({ onSilence: () => (fired += 1) });
    guard.start();
    timers.fire();
    assert.equal(fired, 1);
  });

  test('activity() resets the timer (no silence fired while there is activity)', () => {
    let fired = 0;
    const guard = makeGuard({ onSilence: () => (fired += 1) });
    guard.start();
    guard.activity(); // resets: the previous timer was cleared
    assert.equal(guard._state().armed, true);
    assert.equal(fired, 0);
  });

  test('countCallerTurn returns true and notifies when the maximum is exceeded', () => {
    let maxed = 0;
    const guard = makeGuard({ onMaxTurns: () => (maxed += 1) });
    assert.equal(guard.countCallerTurn(), false); // 1
    assert.equal(guard.countCallerTurn(), false); // 2
    assert.equal(guard.countCallerTurn(), true); // 3 -> limit
    assert.equal(maxed, 1);
    assert.equal(guard._state().callerTurns, 3);
  });

  test('stop() cancels the timer and prevents later triggers', () => {
    let fired = 0;
    const guard = makeGuard({ onSilence: () => (fired += 1) });
    guard.start();
    guard.stop();
    assert.equal(guard._state().armed, false);
    timers.fire(); // even if something were there, stopped blocks it
    assert.equal(fired, 0);
  });

  test('silenceMs=0 disables the silence timeout', () => {
    const guard = makeGuard({ silenceMs: 0 });
    guard.start();
    assert.equal(guard._state().armed, false);
  });

  test('maxCallerTurns=0 disables the turn limit', () => {
    const guard = makeGuard({ maxCallerTurns: 0 });
    for (let i = 0; i < 10; i += 1) assert.equal(guard.countCallerTurn(), false);
  });
});
