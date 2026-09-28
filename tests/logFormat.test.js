// Tests for src/utils/logFormat.js — log formatting (pure, no console or network).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { formatLog } from '../src/utils/logFormat.js';

const NOW = new Date('2026-09-28T10:00:00.000Z');

describe('formatLog', () => {
  test('text format: ISO + uppercase (padded) level + message', () => {
    const line = formatLog('info', ['[media] hi'], { format: 'text', now: NOW });
    assert.equal(line, '2026-09-28T10:00:00.000Z INFO  [media] hi');
  });

  test('json format: includes ts, level and msg', () => {
    const line = formatLog('warn', ['something'], { format: 'json', now: NOW });
    assert.deepEqual(JSON.parse(line), {
      ts: '2026-09-28T10:00:00.000Z',
      level: 'warn',
      msg: 'something',
    });
  });

  test('joins several arguments into a single message', () => {
    const line = formatLog('error', ['[x] failure:', 'ECONNREFUSED'], { format: 'text', now: NOW });
    assert.match(line, /\[x\] failure: ECONNREFUSED$/);
  });

  test('serializes objects as JSON', () => {
    const line = formatLog('info', ['ctx', { a: 1 }], { format: 'json', now: NOW });
    assert.equal(JSON.parse(line).msg, 'ctx {"a":1}');
  });

  test('an Error shows its message/stack, not [object Object]', () => {
    const line = formatLog('error', [new Error('boom')], { format: 'text', now: NOW });
    assert.match(line, /boom/);
    assert.doesNotMatch(line, /\[object Object\]/);
  });

  test('the default format is text', () => {
    const line = formatLog('info', ['x'], { now: NOW });
    assert.match(line, /^2026-09-28T10:00:00.000Z INFO {2}x$/);
  });
});
