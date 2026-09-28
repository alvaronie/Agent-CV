// Token de un solo uso (corta vida) para autenticar el WebSocket /media-stream.
//
// Problema: /media-stream es un WebSocket público. Sin protección, cualquiera que
// descubra la URL podría abrirlo y forzarnos a conectar con OpenAI (gastando tokens).
// Twilio, en cambio, solo conoce la URL porque se la damos en el TwiML del webhook
// (que a su vez está protegido por la firma de Twilio, ver twilioSignature.js).
//
// Solución: al generar el TwiML incrustamos en la URL del <Stream> un token firmado con
// HMAC-SHA256 y con caducidad. Al abrirse el WebSocket, verificamos el token ANTES de
// conectar con OpenAI. El token no necesita estado en servidor: la firma y la marca de
// expiración se validan solas (stateless).
//
// Formato del token:  base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload))
// Payload: { exp: <epoch en segundos> }
//
// Si no hay `STREAM_TOKEN_SECRET` configurado, la verificación queda DESACTIVADA (para
// desarrollo local): createStreamToken() devuelve null y verifyStreamToken() acepta. En
// producción hay que definir el secreto para que la protección esté activa.

import crypto from 'node:crypto';
import { config } from '../config/index.js';

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

/**
 * Crea un token firmado con caducidad. Devuelve null si no hay secreto configurado
 * (protección desactivada en dev).
 * @param {number} [now] epoch en ms (inyectable para tests)
 * @returns {string|null}
 */
export function createStreamToken(now = Date.now()) {
  const { streamTokenSecret, streamTokenTtlSeconds } = config.security;
  if (!streamTokenSecret) return null;

  const payload = { exp: Math.floor(now / 1000) + streamTokenTtlSeconds };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${sign(data, streamTokenSecret)}`;
}

/**
 * Verifica un token del stream.
 * @param {string|undefined} token
 * @param {number} [now] epoch en ms (inyectable para tests)
 * @returns {{valid: boolean, reason?: string}}
 */
export function verifyStreamToken(token, now = Date.now()) {
  const { streamTokenSecret } = config.security;
  // Sin secreto: protección desactivada (dev). Aceptamos pero lo señalamos.
  if (!streamTokenSecret) return { valid: true, reason: 'disabled' };

  if (!token || typeof token !== 'string') return { valid: false, reason: 'missing' };

  const [data, sig] = token.split('.');
  if (!data || !sig) return { valid: false, reason: 'malformed' };

  // Comparación en tiempo constante para no filtrar información por temporización.
  const expected = sign(data, streamTokenSecret);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'bad-signature' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'bad-payload' };
  }

  if (typeof payload.exp !== 'number' || Math.floor(now / 1000) > payload.exp) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true };
}
