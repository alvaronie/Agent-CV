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
//   2. We pass a signed, expiring token as a <Parameter> of the <Stream>, which the
//      media stream verifies on the `start` event before connecting to OpenAI.

import twilio from 'twilio';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { isValidTwilioRequest } from '../security/twilioSignature.js';
import { createStreamToken } from '../security/streamToken.js';
import { canAcceptCall } from './callLimiter.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

/** Public host Twilio reaches us on: PUBLIC_URL if configured, else the request host. */
export function publicHost(request) {
  return config.publicUrl
    ? config.publicUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
    : request.headers.host;
}

/**
 * TwiML that connects the call to our bidirectional media stream.
 * IMPORTANT: Twilio's <Stream> url does NOT support query strings, so the auth token
 * (and any other data) travels as Custom Parameters, which arrive in the `start` event.
 * @param {{host:string, from?:string, extraParams?:Record<string,string>}} opts
 */
export function buildStreamTwiml({ host, from, extraParams = {} }) {
  const token = createStreamToken(); // null if protection is disabled (dev)
  const vr = new VoiceResponse();
  const connect = vr.connect();
  const stream = connect.stream({ url: `wss://${host}/media-stream` });
  if (token) stream.parameter({ name: 'token', value: token });
  // The Media Streams `start` event does not include the caller's number, and we want
  // it for the email summary (Phase 5).
  if (from) stream.parameter({ name: 'from', value: from });
  for (const [name, value] of Object.entries(extraParams)) {
    if (value) stream.parameter({ name, value: String(value) });
  }
  return vr.toString();
}

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

  // 3) Connect the call to the media stream (auth token + caller number as Parameters).
  const from = request.body?.From || request.query?.From || '';
  reply.header('Content-Type', 'text/xml');
  return reply.send(buildStreamTwiml({ host: publicHost(request), from }));
}
