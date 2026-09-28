// Tests de src/telephony/callLimiter.js — límites de concurrencia y diario.
// Cómputo puro en memoria: sin red ni WebSocket.

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

  test('acepta llamadas por debajo de los límites', () => {
    assert.deepEqual(canAcceptCall(), { ok: true });
  });

  test('bloquea al alcanzar la concurrencia máxima', () => {
    registerCallStart();
    registerCallStart();
    assert.deepEqual(canAcceptCall(), { ok: false, reason: 'concurrency' });
  });

  test('al finalizar una llamada se libera un hueco de concurrencia', () => {
    registerCallStart();
    registerCallStart();
    registerCallEnd();
    assert.deepEqual(canAcceptCall(), { ok: true });
    assert.equal(_snapshot().activeCalls, 1);
  });

  test('bloquea al alcanzar el tope diario, aunque no haya llamadas activas', () => {
    // 3 llamadas que empiezan y terminan: concurrencia 0, pero cuenta diaria = 3.
    for (let i = 0; i < 3; i += 1) {
      registerCallStart();
      registerCallEnd();
    }
    assert.equal(_snapshot().activeCalls, 0);
    assert.deepEqual(canAcceptCall(), { ok: false, reason: 'daily' });
  });

  test('la cuenta diaria se reinicia al cambiar de día (UTC)', () => {
    const hoy = new Date('2026-09-28T23:59:00Z');
    for (let i = 0; i < 3; i += 1) {
      registerCallStart(hoy);
      registerCallEnd();
    }
    assert.deepEqual(canAcceptCall(hoy), { ok: false, reason: 'daily' });

    const manana = new Date('2026-09-29T00:01:00Z');
    assert.deepEqual(canAcceptCall(manana), { ok: true });
    assert.equal(_snapshot().callsToday, 0);
  });

  test('con límites a 0, no hay tope (sin límite)', () => {
    config.limits.maxConcurrentCalls = 0;
    config.limits.maxCallsPerDay = 0;
    for (let i = 0; i < 10; i += 1) registerCallStart();
    assert.deepEqual(canAcceptCall(), { ok: true });
  });

  test('registerCallEnd no baja de cero', () => {
    registerCallEnd();
    registerCallEnd();
    assert.equal(_snapshot().activeCalls, 0);
  });
});
