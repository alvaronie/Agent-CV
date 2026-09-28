// Tests de src/utils/logFormat.js — formateo de logs (puro, sin consola ni red).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { formatLog } from '../src/utils/logFormat.js';

const NOW = new Date('2026-09-28T10:00:00.000Z');

describe('formatLog', () => {
  test('formato texto: ISO + nivel en mayúsculas (padded) + mensaje', () => {
    const line = formatLog('info', ['[media] hola'], { format: 'text', now: NOW });
    assert.equal(line, '2026-09-28T10:00:00.000Z INFO  [media] hola');
  });

  test('formato json: incluye ts, level y msg', () => {
    const line = formatLog('warn', ['algo'], { format: 'json', now: NOW });
    assert.deepEqual(JSON.parse(line), {
      ts: '2026-09-28T10:00:00.000Z',
      level: 'warn',
      msg: 'algo',
    });
  });

  test('une varios argumentos en un solo mensaje', () => {
    const line = formatLog('error', ['[x] fallo:', 'ECONNREFUSED'], { format: 'text', now: NOW });
    assert.match(line, /\[x\] fallo: ECONNREFUSED$/);
  });

  test('serializa objetos como JSON', () => {
    const line = formatLog('info', ['ctx', { a: 1 }], { format: 'json', now: NOW });
    assert.equal(JSON.parse(line).msg, 'ctx {"a":1}');
  });

  test('un Error muestra su mensaje/stack, no [object Object]', () => {
    const line = formatLog('error', [new Error('boom')], { format: 'text', now: NOW });
    assert.match(line, /boom/);
    assert.doesNotMatch(line, /\[object Object\]/);
  });

  test('formato por defecto es texto', () => {
    const line = formatLog('info', ['x'], { now: NOW });
    assert.match(line, /^2026-09-28T10:00:00.000Z INFO {2}x$/);
  });
});
