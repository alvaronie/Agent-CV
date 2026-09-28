// Tests de src/security/twilioSignature.js — validación de X-Twilio-Signature.
//
// Generamos firmas válidas con el MISMO algoritmo documentado por Twilio
// (HMAC-SHA1 sobre url + params ordenados, en base64) para comprobar que nuestro
// envoltorio construye bien la URL y pasa los parámetros. No hay red.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { isValidTwilioRequest, buildRequestUrl } from '../src/security/twilioSignature.js';
import { config } from '../src/config/index.js';

const AUTH_TOKEN = 'token-de-prueba';
const PUBLIC_URL = 'https://example.ngrok.app';

// Firma una petición como lo haría Twilio (algoritmo oficial para POST).
function twilioSign(authToken, url, params) {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
}

function makeRequest({ url = '/incoming-call', body = {}, signature } = {}) {
  return {
    url,
    headers: signature ? { 'x-twilio-signature': signature } : {},
    body,
  };
}

describe('isValidTwilioRequest', () => {
  let original;

  beforeEach(() => {
    original = { twilio: { ...config.twilio }, publicUrl: config.publicUrl };
    config.twilio.authToken = AUTH_TOKEN;
    config.publicUrl = PUBLIC_URL;
  });

  afterEach(() => {
    Object.assign(config.twilio, original.twilio);
    config.publicUrl = original.publicUrl;
  });

  test('acepta una petición firmada correctamente', () => {
    const body = { From: '+34600000000', To: '+35227642973', CallSid: 'CA123' };
    const signature = twilioSign(AUTH_TOKEN, `${PUBLIC_URL}/incoming-call`, body);
    assert.equal(isValidTwilioRequest(makeRequest({ body, signature })), true);
  });

  test('rechaza si falta la cabecera de firma', () => {
    const body = { From: '+34600000000' };
    assert.equal(isValidTwilioRequest(makeRequest({ body })), false);
  });

  test('rechaza una firma incorrecta', () => {
    const body = { From: '+34600000000' };
    assert.equal(
      isValidTwilioRequest(makeRequest({ body, signature: 'firma-invalida' })),
      false
    );
  });

  test('rechaza si el cuerpo cambia respecto al firmado (anti-tamper)', () => {
    const body = { From: '+34600000000', CallSid: 'CA123' };
    const signature = twilioSign(AUTH_TOKEN, `${PUBLIC_URL}/incoming-call`, body);
    const tampered = { ...body, From: '+34699999999' };
    assert.equal(isValidTwilioRequest(makeRequest({ body: tampered, signature })), false);
  });

  test('sin Auth Token no se puede verificar: devuelve false', () => {
    config.twilio.authToken = '';
    const body = { From: '+34600000000' };
    const signature = twilioSign(AUTH_TOKEN, `${PUBLIC_URL}/incoming-call`, body);
    assert.equal(isValidTwilioRequest(makeRequest({ body, signature })), false);
  });

  test('buildRequestUrl usa PUBLIC_URL cuando está definido', () => {
    assert.equal(
      buildRequestUrl({ url: '/incoming-call', headers: {} }),
      `${PUBLIC_URL}/incoming-call`
    );
  });

  test('buildRequestUrl cae a las cabeceras si no hay PUBLIC_URL', () => {
    config.publicUrl = '';
    const url = buildRequestUrl({
      url: '/incoming-call',
      headers: { host: 'localhost:3001', 'x-forwarded-proto': 'https' },
    });
    assert.equal(url, 'https://localhost:3001/incoming-call');
  });
});
