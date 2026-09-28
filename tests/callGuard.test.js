// Tests de src/telephony/callGuard.js — silencio y máximo de turnos.
// Temporizadores inyectados: no hay red, WebSocket ni esperas reales.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createCallGuard } from '../src/telephony/callGuard.js';

// Temporizador falso controlable: guarda el callback y permite dispararlo a mano.
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

  test('start() arma el timer de silencio', () => {
    const guard = makeGuard();
    guard.start();
    assert.equal(guard._state().armed, true);
  });

  test('al agotarse el silencio invoca onSilence', () => {
    let fired = 0;
    const guard = makeGuard({ onSilence: () => (fired += 1) });
    guard.start();
    timers.fire();
    assert.equal(fired, 1);
  });

  test('activity() reinicia el timer (no dispara silencio si hay actividad)', () => {
    let fired = 0;
    const guard = makeGuard({ onSilence: () => (fired += 1) });
    guard.start();
    guard.activity(); // reinicia: el timer anterior se limpió
    assert.equal(guard._state().armed, true);
    assert.equal(fired, 0);
  });

  test('countCallerTurn devuelve true y avisa al superar el máximo', () => {
    let maxed = 0;
    const guard = makeGuard({ onMaxTurns: () => (maxed += 1) });
    assert.equal(guard.countCallerTurn(), false); // 1
    assert.equal(guard.countCallerTurn(), false); // 2
    assert.equal(guard.countCallerTurn(), true); // 3 -> límite
    assert.equal(maxed, 1);
    assert.equal(guard._state().callerTurns, 3);
  });

  test('stop() cancela el timer y evita disparos posteriores', () => {
    let fired = 0;
    const guard = makeGuard({ onSilence: () => (fired += 1) });
    guard.start();
    guard.stop();
    assert.equal(guard._state().armed, false);
    timers.fire(); // aunque hubiera algo, stopped lo bloquea
    assert.equal(fired, 0);
  });

  test('silenceMs=0 desactiva el timeout por silencio', () => {
    const guard = makeGuard({ silenceMs: 0 });
    guard.start();
    assert.equal(guard._state().armed, false);
  });

  test('maxCallerTurns=0 desactiva el límite de turnos', () => {
    const guard = makeGuard({ maxCallerTurns: 0 });
    for (let i = 0; i < 10; i += 1) assert.equal(guard.countCallerTurn(), false);
  });
});
