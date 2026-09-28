// Validación de la firma de Twilio (`X-Twilio-Signature`) en el webhook /incoming-call.
//
// Twilio firma cada petición al webhook con HMAC-SHA1 sobre la URL completa (más los
// campos del formulario en un POST), usando el Auth Token de la cuenta como clave.
// Verificarla evita que un tercero que descubra la URL del webhook nos suplante y
// dispare llamadas (y coste). Usamos el validador del SDK oficial (`twilio.validateRequest`).
//
// Reto de la URL: la firma se calcula sobre la URL EXACTA que Twilio invocó, que detrás
// de un túnel/proxy no coincide con el host local. Por eso preferimos `PUBLIC_URL` (la
// URL pública real) y, si no está, reconstruimos desde las cabeceras de proxy.

import twilio from 'twilio';
import { config } from '../config/index.js';

/**
 * Reconstruye la URL absoluta que Twilio usó para llamar al webhook.
 * @param {import('fastify').FastifyRequest} request
 * @returns {string}
 */
export function buildRequestUrl(request) {
  const path = request.url || request.raw?.url || '';
  if (config.publicUrl) {
    return `${config.publicUrl.replace(/\/$/, '')}${path}`;
  }
  const proto =
    request.headers['x-forwarded-proto'] || request.protocol || 'https';
  const host = request.headers['x-forwarded-host'] || request.headers.host || '';
  return `${proto}://${host}${path}`;
}

/**
 * ¿La petición viene firmada válidamente por Twilio?
 * Sin Auth Token o sin cabecera de firma, devuelve false (no se puede verificar).
 * @param {import('fastify').FastifyRequest} request
 * @returns {boolean}
 */
export function isValidTwilioRequest(request) {
  const authToken = config.twilio.authToken;
  if (!authToken) return false;

  const signature = request.headers['x-twilio-signature'];
  if (!signature) return false;

  const url = buildRequestUrl(request);
  const params =
    request.body && typeof request.body === 'object' ? request.body : {};

  return twilio.validateRequest(authToken, signature, url, params);
}
