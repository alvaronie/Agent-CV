// Sends the call summary by email.
//
// Provider: Resend (EMAIL_PROVIDER=resend). Called via REST API with `fetch`, no SDK or
// new dependencies. If it is ever switched to SendGrid or SES, just add another
// `sendWith...` function here: the rest of the project keeps calling sendSummaryEmail().
//
// Degradation: if EMAIL_API_KEY / EMAIL_FROM / EMAIL_TO are missing we don't throw, we
// just warn and return false. This way a call is never broken by the email configuration,
// which is the last thing to happen and the least critical.

import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const RESEND_URL = 'https://api.resend.com/emails';
const REQUEST_TIMEOUT_MS = 15000;

/**
 * @param {{subject:string, body:string}} message
 * @returns {Promise<boolean>} true if sent, false if skipped or failed.
 */
export async function sendSummaryEmail({ subject, body }) {
  const { provider, apiKey, from, to } = config.email;

  const missing = [
    !apiKey && 'EMAIL_API_KEY',
    !from && 'EMAIL_FROM',
    !to && 'EMAIL_TO',
  ].filter(Boolean);

  if (missing.length) {
    logger.warn(`[email] send skipped, missing configuration: ${missing.join(', ')}`);
    return false;
  }

  if (provider !== 'resend') {
    logger.warn(`[email] provider '${provider}' not implemented, send skipped`);
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
        // Resend accepts several recipients; we allow a comma-separated list.
        to: to.split(',').map((addr) => addr.trim()).filter(Boolean),
        subject,
        text: body,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      logger.error(`[email] Resend returned ${res.status}: ${detail.slice(0, 300)}`);
      return false;
    }

    logger.info('[email] summary sent');
    return true;
  } catch (err) {
    logger.error('[email] error sending the summary:', err.message);
    return false;
  }
}
