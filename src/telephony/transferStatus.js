// Twilio <Dial> action callback for transfers (/transfer-status).
//
// Twilio requests this URL when the transfer <Dial> ends, with the outcome in
// DialCallStatus. Three cases:
//   - Álvaro answered and they talked (completed/answered): the call is over -> hang up
//     and send the single summary email.
//   - The caller hung up while it was ringing (parent CallStatus no longer in-progress):
//     same, the call is over.
//   - Álvaro didn't pick up (no-answer, busy/rejected, failed, canceled) and the caller is
//     still on the line: reconnect the call to the agent, which explains that Álvaro
//     couldn't be reached and carries on the conversation.
// The outcome is written into the call transcript so it shows up in the summary.
//
// Protected by the same Twilio signature check as the incoming-call webhook.

import twilio from 'twilio';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { isValidTwilioRequest } from '../security/twilioSignature.js';
import { callSessions as defaultSessions } from './callSessions.js';
import { buildStreamTwiml, publicHost } from './twilioWebhook.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

const CONNECTED = new Set(['completed', 'answered']);

function hangupTwiml() {
  const vr = new VoiceResponse();
  vr.hangup();
  return vr.toString();
}

export function createTransferStatusHandler({ sessions = defaultSessions } = {}) {
  return function handleTransferStatus(request, reply) {
    if (config.security.validateTwilioSignature && !isValidTwilioRequest(request)) {
      logger.warn('[transfer] invalid or missing Twilio signature; request rejected');
      reply.code(403).header('Content-Type', 'text/plain');
      return reply.send('Forbidden');
    }

    const body = request.body || {};
    const callSid = body.CallSid || '';
    const status = body.DialCallStatus || '';
    const callerStillOnLine = !body.CallStatus || body.CallStatus === 'in-progress';
    const lang = request.query?.lang === 'es' ? 'es' : 'en';

    sessions.recordTransferOutcome(callSid, status);
    reply.header('Content-Type', 'text/xml');

    if (CONNECTED.has(status) || !callerStillOnLine) {
      logger.info(`[transfer] call over after transfer (DialCallStatus=${status || 'unknown'})`);
      sessions.finalizeLater(callSid);
      return reply.send(hangupTwiml());
    }

    // Álvaro didn't pick up: back to the agent, which takes it from there.
    logger.warn(`[transfer] not connected (DialCallStatus=${status || 'unknown'}); back to the agent`);
    const from = body.From || sessions.get(callSid)?.from || '';
    return reply.send(
      buildStreamTwiml({
        host: publicHost(request),
        from,
        extraParams: { resume: '1', lang },
      })
    );
  };
}

export const handleTransferStatus = createTransferStatusHandler();
