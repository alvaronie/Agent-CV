// Tests for the voice-provider switch: OpenAI session config in audio vs text mode,
// provider selection, and the per-answer latency meter. Pure functions: no network.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildSessionUpdate } from '../src/realtime/openaiRealtime.js';
import { isElevenLabsEnabled } from '../src/telephony/mediaStream.js';
import { createLatencyMeter } from '../src/telephony/latencyMeter.js';

const TOOLS = [{ type: 'function', name: 'end_call' }];

describe('buildSessionUpdate', () => {
  test('audio mode (default): OpenAI speaks in Twilio format', () => {
    const { type, session } = buildSessionUpdate({
      instructions: 'x',
      tools: TOOLS,
      voice: 'alloy',
      transcribeModel: 'gpt-4o-mini-transcribe',
    });
    assert.equal(type, 'session.update');
    assert.equal(session.output_modalities, undefined);
    assert.deepEqual(session.audio.output, { format: { type: 'audio/pcmu' }, voice: 'alloy' });
    assert.deepEqual(session.audio.input.format, { type: 'audio/pcmu' });
    assert.equal(session.audio.input.transcription.model, 'gpt-4o-mini-transcribe');
    assert.deepEqual(session.tools, TOOLS);
  });

  test('text mode (ElevenLabs voice): text only, caller audio still in, tools kept', () => {
    const { session } = buildSessionUpdate({
      instructions: 'x',
      tools: TOOLS,
      outputMode: 'text',
      transcribeModel: 'gpt-4o-mini-transcribe',
    });
    assert.deepEqual(session.output_modalities, ['text']);
    assert.equal(session.audio.output, undefined);
    assert.equal(session.audio.input.turn_detection.type, 'server_vad');
    assert.equal(session.audio.input.transcription.model, 'gpt-4o-mini-transcribe');
    assert.equal(session.tool_choice, 'auto');
  });
});

describe('isElevenLabsEnabled', () => {
  const cfg = (voiceProvider, apiKey, voiceId) => ({
    voiceProvider,
    elevenlabs: { apiKey, voiceId },
  });

  test('only when selected AND configured', () => {
    assert.equal(isElevenLabsEnabled(cfg('elevenlabs', 'k', 'v')), true);
    assert.equal(isElevenLabsEnabled(cfg('openai', 'k', 'v')), false);
    assert.equal(isElevenLabsEnabled(cfg('elevenlabs', '', 'v')), false, 'missing key: OpenAI voice');
    assert.equal(isElevenLabsEnabled(cfg('elevenlabs', 'k', '')), false, 'missing voice: OpenAI voice');
  });
});

describe('createLatencyMeter', () => {
  function clock(start = 1000) {
    let t = start;
    return { now: () => t, advance: (ms) => (t += ms) };
  }

  test('measures end of caller speech -> first answer audio, and first text', () => {
    const c = clock();
    const m = createLatencyMeter({ now: c.now });
    m.callerStopped();
    c.advance(400);
    m.firstText();
    c.advance(350);
    assert.deepEqual(m.firstAudio(), { audioMs: 750, textMs: 400 });
    assert.equal(m.firstAudio(), null, 'only the first chunk of the answer counts');
  });

  test('audio with no pending turn (greeting) is not a sample', () => {
    const m = createLatencyMeter({ now: clock().now });
    assert.equal(m.firstAudio(), null);
    assert.equal(m.summary(), null);
  });

  test('barge-in resets the pending turn', () => {
    const m = createLatencyMeter({ now: clock().now });
    m.callerStopped();
    m.reset();
    assert.equal(m.firstAudio(), null);
  });

  test('samples over 15 s are discarded (not an answer to that turn)', () => {
    const c = clock();
    const m = createLatencyMeter({ now: c.now });
    m.callerStopped();
    c.advance(20000);
    assert.equal(m.firstAudio(), null);
    assert.equal(m.summary(), null);
  });

  test('summary aggregates the call', () => {
    const c = clock();
    const m = createLatencyMeter({ now: c.now });
    for (const ms of [900, 600, 1200]) {
      m.callerStopped();
      c.advance(ms);
      m.firstAudio();
    }
    assert.deepEqual(m.summary(), {
      answers: 3,
      avgMs: 900,
      medianMs: 900,
      minMs: 600,
      maxMs: 1200,
    });
  });
});
