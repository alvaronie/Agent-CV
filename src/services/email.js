// Envía por email el resumen de la llamada.
//
// Proveedor: Resend (EMAIL_PROVIDER=resend). Se llama por API REST con `fetch`, sin SDK
// ni dependencias nuevas. Si algún día se cambia a SendGrid o SES, basta con añadir otra
// función `sendWith...` aquí: el resto del proyecto sigue llamando a sendSummaryEmail().
//
// Degradación: si falta EMAIL_API_KEY / EMAIL_FROM / EMAIL_TO no lanzamos error, solo
// avisamos y devolvemos false. Así una llamada nunca se rompe por la configuración del
// email, que es lo último que ocurre y lo menos crítico.

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const RESEND_URL = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 15000;

/**
 * @param {{subject:string, body:string}} message
 * @returns {Promise<boolean>} true si se envió, false si se omitió o falló.
 */
export async function sendSummaryEmail({ subject, body }) {
  const { provider, apiKey, from, to } = config.email;

  const missing = [
    !apiKey && 'EMAIL_API_KEY',
    !from && 'EMAIL_FROM',
    !to && 'EMAIL_TO',
  ].filter(Boolean);

  if (missing.length) {
    logger.warn(`[email] envío omitido, falta configuración: ${missing.join(', ')}`);
    return false;
  }

  if (provider !== 'resend') {
    logger.warn(`[email] proveedor '${provider}' no implementado, envío omitido`);
    return false;
  }

  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        // Resend acepta varios destinatarios; permitimos una lista separada por comas.
        to: to.split(',').map((addr) => addr.trim()).filter(Boolean),
        subject,
        text: body,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      logger.error(`[email] Resend devolvió ${res.status}: ${detail.slice(0, 300)}`);
      return false;
    }

    logger.info('[email] resumen enviado');
    return true;
  } catch (err) {
    logger.error('[email] error enviando el resumen:', err.message);
    return false;
  }
}
