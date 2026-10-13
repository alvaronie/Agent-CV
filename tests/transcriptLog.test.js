// Tests for src/telephony/transcriptLog.js — transcript kept in conversation order.
// Pure in-memory logic: no network or WebSocket.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createTranscriptLog } from '../src/telephony/transcriptLog.js';

describe('createTranscriptLog', () => {
  test('regression: a late caller transcript lands before the agent reply', () => {
    // Real call: "Entendido, Sara Nieto" appeared before "Soy Sara Nieto" because the
    // caller's transcription completed after the agent had answered.
    const log = createTranscriptLog();
    log.reserve('item_caller', 'caller'); // caller audio committed
    log.reserve('item_agent', 'agent'); // agent answer starts
    log.add('agent', 'Entendido, Sara Nieto.', 'item_agent'); // arrives first
    log.add('caller', 'Soy Sara Nieto.', 'item_caller'); // arrives late

    assert.deepEqual(log.toTurns(), [
      { role: 'caller', text: 'Soy Sara Nieto.' },
      { role: 'agent', text: 'Entendido, Sara Nieto.' },
    ]);
  });

  test('reserved items with no text are left out', () => {
    const log = createTranscriptLog();
    log.reserve('a', 'caller');
    log.reserve('b', 'agent');
    log.add('agent', 'Hola', 'b');
    assert.deepEqual(log.toTurns(), [{ role: 'agent', text: 'Hola' }]);
  });

  test('text with an unknown or missing item id is appended in arrival order', () => {
    const log = createTranscriptLog();
    log.add('agent', 'uno', 'never-reserved');
    log.add('caller', 'dos');
    assert.deepEqual(log.toTurns(), [
      { role: 'agent', text: 'uno' },
      { role: 'caller', text: 'dos' },
    ]);
  });

  test('empty or whitespace-only text is ignored', () => {
    const log = createTranscriptLog();
    log.reserve('a', 'caller');
    log.add('caller', '   ', 'a');
    log.add('caller', '', 'b');
    assert.deepEqual(log.toTurns(), []);
  });

  test('duplicate reservations do not create a second slot', () => {
    const log = createTranscriptLog();
    log.reserve('a', 'caller');
    log.reserve('a', 'caller');
    log.add('caller', 'hola', 'a');
    assert.equal(log.toTurns().length, 1);
  });

  test('clear() drops everything', () => {
    const log = createTranscriptLog();
    log.reserve('a', 'caller');
    log.add('caller', 'hola', 'a');
    log.clear();
    assert.deepEqual(log.toTurns(), []);
  });
});
