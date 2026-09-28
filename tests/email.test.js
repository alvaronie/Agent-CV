// Tests de src/services/email.js — envío vía Resend.
//
// Sustituimos globalThis.fetch: no se contacta con Resend en ningún momento.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { sendSummaryEmail } from '../src/services/email.js';
import { config } from '../src/config/index.js';

const realFetch = globalThis.fetch;
let original;
let lastRequest = null;

function stubFetch({ ok = true, status = 200 } = {}) {
  globalThis.fetch = async (url, options) => {
    lastRequest = { url, options, body: JSON.parse(options.body) };
    return {
      ok,
      status,
      json: async () => ({ id: 'email-123' }),
      text: async () => 'error detail',
    };
  };
}

describe('sendSummaryEmail', () => {
  beforeEach(() => {
    original = { ...config.email };
    lastRequest = null;
    config.email.provider = 'resend';
    config.email.apiKey = 'test-key';
    config.email.from = 'agente@example.com';
    config.email.to = 'yo@example.com';
  });

  afterEach(() => {
    Object.assign(config.email, original);
    globalThis.fetch = realFetch;
  });

  test('envía el email y devuelve true', async () => {
    stubFetch();
    const sent = await sendSummaryEmail({ subject: 'Asunto', body: 'Cuerpo' });

    assert.equal(sent, true);
    assert.equal(lastRequest.url, 'https://api.resend.com/emails');
    assert.equal(lastRequest.options.headers.Authorization, 'Bearer test-key');
    assert.deepEqual(lastRequest.body.to, ['yo@example.com']);
    assert.equal(lastRequest.body.subject, 'Asunto');
    assert.equal(lastRequest.body.text, 'Cuerpo');
  });

  test('admite varios destinatarios separados por comas', async () => {
    stubFetch();
    config.email.to = 'uno@example.com, dos@example.com';
    await sendSummaryEmail({ subject: 'A', body: 'B' });

    assert.deepEqual(lastRequest.body.to, ['uno@example.com', 'dos@example.com']);
  });

  test('sin API key no envía y devuelve false, sin lanzar error', async () => {
    stubFetch();
    config.email.apiKey = '';
    const sent = await sendSummaryEmail({ subject: 'A', body: 'B' });

    assert.equal(sent, false);
    assert.equal(lastRequest, null, 'no debe llamarse a la API');
  });

  test('proveedor no soportado: no envía y devuelve false', async () => {
    stubFetch();
    config.email.provider = 'sendgrid';
    assert.equal(await sendSummaryEmail({ subject: 'A', body: 'B' }), false);
    assert.equal(lastRequest, null);
  });

  test('error HTTP: devuelve false sin lanzar', async () => {
    stubFetch({ ok: false, status: 422 });
    assert.equal(await sendSummaryEmail({ subject: 'A', body: 'B' }), false);
  });

  test('error de red: devuelve false sin lanzar', async () => {
    globalThis.fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    assert.equal(await sendSummaryEmail({ subject: 'A', body: 'B' }), false);
  });
});
