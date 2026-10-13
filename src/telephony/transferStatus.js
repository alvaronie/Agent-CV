// Twilio <Dial> action callback for transfers (/transfer-status).
//
// Twilio requests this URL when the transfer <Dial> ends, with the outcome in
// DialCallStatus. If Álvaro and the caller actually talked, we just hang up. Otherwise
// (blocked by geo permissions, no answer, busy, failed) we apologize in the conversation
// language before hanging up, instead of letting the call drop silently.
//
// Protected by the same Twilio signature check as the incoming-call webhook.

import twilio from 'twilio';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { isValidTwilioRequest } from '../security/twilioSignature.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

const APOLOGY = {
  es: {
    language: 'es-ES',
    text:
      'Lo siento, ahora mismo no ha sido posible contactar con Álvaro. Recibirá un ' +
      'resumen de esta llamada y se pondrá en contacto contigo. Gracias por llamar.',
  },
  en: {
    language: 'en-US',
    text:
      "Sorry, I couldn't reach Álvaro right now. He will receive a summary of this call " +
      'and get back to you. Thank you for calling.',
  },
};

/**
 * Builds the TwiML for a finished transfer. Pure function (unit tested).
 * @param {string} dialCallStatus - Twilio DialCallStatus.
 * @param {string} [lang] - 'es' or 'en'.
 * @returns {string}
 */
export function buildTransferStatusTwiml(dialCallStatus, lang) {
  const vr = new VoiceResponse();
  // `completed` means the two parties were connected and the call ended normally.
  if (dialCallStatus !== 'completed' && dialCallStatus !== 'answered') {
    const { language, text } = APOLOGY[lang] || APOLOGY.en;
    vr.say({ language }, text);
  }
  vr.hangup();
  return vr.toString();
}

export function handleTransferStatus(request, reply) {
  if (config.security.validateTwilioSignature && !isValidTwilioRequest(request)) {
    logger.warn('[transfer] invalid or missing Twilio signature; request rejected');
    reply.code(403).header('Content-Type', 'text/plain');
    return reply.send('Forbidden');
  }

  const status = request.body?.DialCallStatus || '';
  const lang = request.query?.lang;
  if (status !== 'completed' && status !== 'answered') {
    logger.warn(`[transfer] transfer did not connect (DialCallStatus=${status || 'unknown'})`);
  }

  reply.header('Content-Type', 'text/xml');
  return reply.send(buildTransferStatusTwiml(status, lang));
}
