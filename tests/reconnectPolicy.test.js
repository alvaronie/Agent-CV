// Tests for src/realtime/reconnectPolicy.js — reconnection decision (pure, no network).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { nextReconnect } from '../src/realtime/reconnectPolicy.js';

describe('nextReconnect', () => {
  test('retries while the maximum is not reached, with exponential backoff', () => {
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

  test('stops retrying when the maximum is reached', () => {
    assert.deepEqual(nextReconnect({ attempt: 3, maxAttempts: 3 }), {
      shouldReconnect: false,
      delayMs: 0,
    });
    assert.deepEqual(nextReconnect({ attempt: 5, maxAttempts: 3 }), {
      shouldReconnect: false,
      delayMs: 0,
    });
  });

  test('the backoff is capped by maxDelayMs', () => {
    const { delayMs } = nextReconnect({
      attempt: 10,
      maxAttempts: 20,
      baseDelayMs: 500,
      maxDelayMs: 4000,
    });
    assert.equal(delayMs, 4000);
  });

  test('with maxAttempts=0 it never retries', () => {
    assert.deepEqual(nextReconnect({ attempt: 0, maxAttempts: 0 }), {
      shouldReconnect: false,
      delayMs: 0,
    });
  });
});
