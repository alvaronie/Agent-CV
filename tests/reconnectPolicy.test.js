// Tests de src/realtime/reconnectPolicy.js — decisión de reconexión (pura, sin red).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { nextReconnect } from '../src/realtime/reconnectPolicy.js';

describe('nextReconnect', () => {
  test('reintenta mientras no se alcance el máximo, con backoff exponencial', () => {
    assert.deepEqual(nextReconnect({ attempt: 0, maxAttempts: 3 }), {
      shouldReconnect: true,
      delayMs: 500,
    });
    assert.deepEqual(nextReconnect({ attempt: 1, maxAttempts: 3 }), {
      shouldReconnect: true,
      delayMs: 1000,
    });
    assert.deepEqual(nextReconnect({ attempt: 2, maxAttempts: 3 }), {
      shouldReconnect: true,
      delayMs: 2000,
    });
  });

  test('deja de reintentar al alcanzar el máximo', () => {
    assert.deepEqual(nextReconnect({ attempt: 3, maxAttempts: 3 }), {
      shouldReconnect: false,
      delayMs: 0,
    });
    assert.deepEqual(nextReconnect({ attempt: 5, maxAttempts: 3 }), {
      shouldReconnect: false,
      delayMs: 0,
    });
  });

  test('el backoff está acotado por maxDelayMs', () => {
    const { delayMs } = nextReconnect({
      attempt: 10,
      maxAttempts: 20,
      baseDelayMs: 500,
      maxDelayMs: 4000,
    });
    assert.equal(delayMs, 4000);
  });

  test('con maxAttempts=0 no se reintenta nunca', () => {
    assert.deepEqual(nextReconnect({ attempt: 0, maxAttempts: 0 }), {
      shouldReconnect: false,
      delayMs: 0,
    });
  });
});
