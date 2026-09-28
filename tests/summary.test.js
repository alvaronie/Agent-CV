// Tests for src/services/summary.js
//
// OpenAI is not called: we replace globalThis.fetch with a double that returns a response
// with the real shape of Chat Completions.
//
// NOTE: the summary email is Spanish by design, so the assertions below check Spanish
// content (labels, JSON keys, default subject). That is expected behavior.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { generateSummary, formatTranscript } from '../src/services/summary.js';
import { config } from '../src/config/index.js';

const TURNS = [
  { role: 'agent', text: 'Hello, this is the voice assistant.' },
  { role: 'caller', text: 'Hi, I am Marta from Acme. Is Alvaro available?' },
  { role: 'agent', text: 'He is not, but I can take your details.' },
];

const realFetch = globalThis.fetch;
let lastRequest = null;

function stubFetch(content, { ok = true, status = 200 } = {}) {
  globalThis.fetch = async (url, options) => {
    lastRequest = { url, options, body: JSON.parse(options.body) };
    return {
      ok,
      status,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => content,
    };
  };
}

describe('formatTranscript', () => {
  test('labels each turn and drops empty ones', () => {
    const text = formatTranscript([...TURNS, { role: 'caller', text: '' }]);
    assert.equal(text.split('\n').length, 3);
    assert.match(text, /^AGENTE: Hello, this is the voice assistant\./);
    assert.match(text, /LLAMANTE: Hi, I am Marta from Acme\./);
  });

  test('returns an empty string with no turns', () => {
    assert.equal(formatTranscript([]), '');
    assert.equal(formatTranscript(), '');
  });
});

describe('generateSummary', () => {
  beforeEach(() => {
    lastRequest = null;
    config.openai.apiKey = config.openai.apiKey || 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('returns subject and body from the model JSON', async () => {
    stubFetch(
      JSON.stringify({ asunto: 'Marta (Acme) pide contacto', resumen: 'Quién llamó: Marta.' })
    );

    const { subject, body } = await generateSummary(TURNS, {
      from: '+15550001111',
      durationSeconds: 42,
    });

    assert.equal(subject, 'Marta (Acme) pide contacto');
    assert.equal(body, 'Quién llamó: Marta.');
  });

  test('sends the transcript and metadata to the model', async () => {
    stubFetch(JSON.stringify({ asunto: 'x', resumen: 'y' }));
    await generateSummary(TURNS, { from: '+15550001111', durationSeconds: 42 });

    const userMessage = lastRequest.body.messages.at(-1).content;
    assert.match(userMessage, /Número del llamante: \+15550001111/);
    assert.match(userMessage, /Duración: 42 segundos/);
    assert.match(userMessage, /LLAMANTE: Hi, I am Marta from Acme\./);
    assert.equal(lastRequest.body.response_format.type, 'json_object');
  });

  test('if the model does not return JSON, uses the text as the body', async () => {
    stubFetch('Resumen en texto plano.');
    const { subject, body } = await generateSummary(TURNS);

    assert.equal(subject, 'Llamada al agente de CV');
    assert.equal(body, 'Resumen en texto plano.');
  });

  test('throws if there are no turns', async () => {
    await assert.rejects(() => generateSummary([]), /no transcript/);
  });

  test('throws if the API responds with a failure', async () => {
    stubFetch('rate limited', { ok: false, status: 429 });
    await assert.rejects(() => generateSummary(TURNS), /429/);
  });
});
