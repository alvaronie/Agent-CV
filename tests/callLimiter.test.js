// Tests for src/telephony/callLimiter.js — concurrency and daily limits.
// Pure in-memory computation: no network or WebSocket.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  canAcceptCall,
  registerCallStart,
  registerCallEnd,
  _reset,
  _snapshot,
} from '../src/telephony/callLimiter.js';
import { config } from '../src/config/index.js';

describe('callLimiter', () => {
  let original;

  beforeEach(() => {
    original = { ...config.limits };
    config.limits.maxConcurrentCalls = 2;
    config.limits.maxCallsPerDay = 3;
    _reset();
  });

  afterEach(() => {
    Object.assign(config.limits, original);
    _reset();
  });

  test('accepts calls below the limits', () => {
    assert.deepEqual(canAcceptCall(), { ok: true });
  });

  test('blocks when the concurrency maximum is reached', () => {
    registerCallStart();
    registerCallStart();
    assert.deepEqual(canAcceptCall(), { ok: false, reason: 'concurrency' });
  });

  test('ending a call frees a concurrency slot', () => {
    registerCallStart();
    registerCallStart();
    registerCallEnd();
    assert.deepEqual(canAcceptCall(), { ok: true });
    assert.equal(_snapshot().activeCalls, 1);
  });

  test('blocks when the daily cap is reached, even with no active calls', () => {
    // 3 calls that start and end: concurrency 0, but daily count = 3.
    for (let i = 0; i < 3; i += 1) {
      registerCallStart();
      registerCallEnd();
    }
    assert.equal(_snapshot().activeCalls, 0);
    assert.deepEqual(canAcceptCall(), { ok: false, reason: 'daily' });
  });

  test('the daily count resets when the day changes (UTC)', () => {
    const today = new Date('2026-09-28T23:59:00Z');
    for (let i = 0; i < 3; i += 1) {
      registerCallStart(today);
      registerCallEnd();
    }
    assert.deepEqual(canAcceptCall(today), { ok: false, reason: 'daily' });

    const tomorrow = new Date('2026-09-29T00:01:00Z');
    assert.deepEqual(canAcceptCall(tomorrow), { ok: true });
    assert.equal(_snapshot().callsToday, 0);
  });

  test('with limits at 0, there is no cap (unlimited)', () => {
    config.limits.maxConcurrentCalls = 0;
    config.limits.maxCallsPerDay = 0;
    for (let i = 0; i < 10; i += 1) registerCallStart();
    assert.deepEqual(canAcceptCall(), { ok: true });
  });

  test('registerCallEnd does not go below zero', () => {
    registerCallEnd();
    registerCallEnd();
    assert.equal(_snapshot().activeCalls, 0);
  });
});
