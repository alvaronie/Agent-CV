// Tests de src/security/streamToken.js — token HMAC con caducidad para /media-stream.
// No hay red ni estado externo: todo es cómputo local con un secreto de prueba.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createStreamToken, verifyStreamToken } from '../src/security/streamToken.js';
import { config } from '../src/config/index.js';

describe('streamToken', () => {
  let original;

  beforeEach(() => {
    original = { ...config.security };
    config.security.streamTokenSecret = 'secreto-de-prueba';
    config.security.streamTokenTtlSeconds = 300;
  });

  afterEach(() => {
    Object.assign(config.security, original);
  });

  test('un token recién creado se verifica como válido', () => {
    const token = createStreamToken();
    assert.equal(typeof token, 'string');
    assert.equal(verifyStreamToken(token).valid, true);
  });

  test('token ausente o vacío es inválido', () => {
    assert.deepEqual(verifyStreamToken(undefined), { valid: false, reason: 'missing' });
    assert.deepEqual(verifyStreamToken(''), { valid: false, reason: 'missing' });
  });

  test('token con formato incorrecto es inválido', () => {
    assert.deepEqual(verifyStreamToken('sinpunto'), { valid: false, reason: 'malformed' });
  });

  test('firma manipulada es inválida', () => {
    const token = createStreamToken();
    const [data] = token.split('.');
    const tampered = `${data}.firmafalsa`;
    assert.equal(verifyStreamToken(tampered).valid, false);
  });

  test('payload manipulado (misma longitud de firma) no cuela', () => {
    const token = createStreamToken();
    const [data, sig] = token.split('.');
    // Cambiamos el payload pero mantenemos la firma antigua: debe fallar la firma.
    const otroData = Buffer.from(JSON.stringify({ exp: 9999999999 })).toString('base64url');
    assert.equal(verifyStreamToken(`${otroData}.${sig}`).valid, false);
  });

  test('token caducado es inválido', () => {
    // Creado en un instante muy anterior; ya expiró respecto a "ahora".
    const pasado = Date.now() - 10 * 60 * 1000; // hace 10 min
    const token = createStreamToken(pasado);
    const result = verifyStreamToken(token);
    assert.deepEqual(result, { valid: false, reason: 'expired' });
  });

  test('sin secreto configurado, la verificación queda desactivada (dev)', () => {
    config.security.streamTokenSecret = '';
    assert.equal(createStreamToken(), null);
    assert.deepEqual(verifyStreamToken(undefined), { valid: true, reason: 'disabled' });
  });

  test('token firmado con otro secreto no se acepta', () => {
    const token = createStreamToken();
    config.security.streamTokenSecret = 'otro-secreto-distinto';
    assert.equal(verifyStreamToken(token).valid, false);
  });
});
