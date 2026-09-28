// Twilio incoming-call webhook.
//
// We respond with TwiML <Connect><Stream> to open a bidirectional WebSocket
// (Media Streams) to our /media-stream route. From there, the call audio flows in real
// time to OpenAI Realtime and comes back as the agent's voice.
//
// The Stream URL must be absolute and secure (wss://). We derive it from the public host
// Twilio called us on (or from PUBLIC_URL if defined).
//
// SECURITY (Phase 6):
//   1. We validate the `X-Twilio-Signature`: if it is not a legitimate Twilio request,
//      we respond 403 and do not emit TwiML.
//   2. We embed a signed, expiring token in the <Stream> URL, which /media-stream
//      verifies on open (so only Twilio can open the WebSocket).

import twilio from 'twilio';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { isValidTwilioRequest } from '../security/twilioSignature.js';
import { createStreamToken } from '../security/streamToken.js';
import { canAcceptCall } from './callLimiter.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export function handleIncomingCall(request, reply) {
  // 1) Twilio signature check (unless disabled for local testing).
  if (config.security.validateTwilioSignature && !isValidTwilioRequest(request)) {
    logger.warn('[webhook] invalid or missing Twilio signature; request rejected');
    reply.code(403).header('Content-Type', 'text/plain');
    return reply.send('Forbidden');
  }

  // 2) Admission limit (concurrency / daily cap): cost guardrail. If we are at the
  // limit, respond with a short spoken message and hang up, without opening the stream.
  const admission = canAcceptCall();
  if (!admission.ok) {
    logger.warn(`[webhook] call rejected by limit: ${admission.reason}`);
    const busy = new VoiceResponse();
    busy.say(
      { language: 'en-US' },
      'Sorry, the assistant is not available right now. Please try again later.'
    );
    busy.hangup();
    reply.header('Content-Type', 'text/xml');
    return reply.send(busy.toString());
  }

  // Public host: prefer PUBLIC_URL if configured; otherwise the request host.
  const host = config.publicUrl
    ? config.publicUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
    : request.headers.host;

  // 3) Authentication token for the WebSocket (null if protection is disabled).
  const token = createStreamToken();
  const streamUrl = `wss://${host}/media-stream${
    token ? `?token=${encodeURIComponent(token)}` : ''
  }`;

  const vr = new VoiceResponse();
  const connect = vr.connect();
  const stream = connect.stream({ url: streamUrl });

  // Pass the caller's number to the WebSocket: the Media Streams `start` event does not
  // include it, and we want it for the email summary (Phase 5).
  const from = request.body?.From || request.query?.From || '';
  if (from) {
    stream.parameter({ name: 'from', value: from });
  }

  reply.header('Content-Type', 'text/xml');
  return reply.send(vr.toString());
}
