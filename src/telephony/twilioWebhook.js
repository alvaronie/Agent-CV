// Webhook de llamada entrante de Twilio.
//
// Respondemos con TwiML <Connect><Stream> para abrir un WebSocket bidireccional
// (Media Streams) hacia nuestra ruta /media-stream. A partir de ahí, el audio de la
// llamada viaja en tiempo real hacia OpenAI Realtime y vuelve como voz del agente.
//
// La URL del Stream debe ser absoluta y segura (wss://). La derivamos del host
// público por el que Twilio nos ha llamado (o de PUBLIC_URL si está definido).
//
// SEGURIDAD (Fase 6):
//   1. Validamos la firma `X-Twilio-Signature`: si no es una petición legítima de
//      Twilio, respondemos 403 y no emitimos TwiML.
//   2. Incrustamos en la URL del <Stream> un token firmado y con caducidad, que
//      /media-stream verifica al abrirse (así solo Twilio puede abrir el WebSocket).

import twilio from 'twilio';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { isValidTwilioRequest } from '../security/twilioSignature.js';
import { createStreamToken } from '../security/streamToken.js';
import { canAcceptCall } from './callLimiter.js';

const VoiceResponse = twilio.twiml.VoiceResponse;

export function handleIncomingCall(request, reply) {
  // 1) Verificación de firma de Twilio (salvo que se desactive para pruebas locales).
  if (config.security.validateTwilioSignature && !isValidTwilioRequest(request)) {
    logger.warn('[webhook] firma de Twilio inválida o ausente; petición rechazada');
    reply.code(403).header('Content-Type', 'text/plain');
    return reply.send('Forbidden');
  }

  // 2) Límite de admisión (concurrencia / tope diario): guardarraíl de coste. Si estamos
  // al límite, respondemos con una locución breve y colgamos, sin abrir el stream.
  const admission = canAcceptCall();
  if (!admission.ok) {
    logger.warn(`[webhook] llamada rechazada por límite: ${admission.reason}`);
    const busy = new VoiceResponse();
    busy.say(
      { language: 'en-US' },
      'Sorry, the assistant is not available right now. Please try again later.'
    );
    busy.hangup();
    reply.header('Content-Type', 'text/xml');
    return reply.send(busy.toString());
  }

  // Host público: preferimos PUBLIC_URL si está configurado; si no, el host de la petición.
  const host = config.publicUrl
    ? config.publicUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')
    : request.headers.host;

  // 3) Token de autenticación para el WebSocket (null si la protección está desactivada).
  const token = createStreamToken();
  const streamUrl = `wss://${host}/media-stream${
    token ? `?token=${encodeURIComponent(token)}` : ''
  }`;

  const vr = new VoiceResponse();
  const connect = vr.connect();
  const stream = connect.stream({ url: streamUrl });

  // Pasamos el número del llamante al WebSocket: el evento `start` de Media Streams no
  // lo incluye, y lo queremos para el resumen por email (Fase 5).
  const from = request.body?.From || request.query?.From || '';
  if (from) {
    stream.parameter({ name: 'from', value: from });
  }

  reply.header('Content-Type', 'text/xml');
  return reply.send(vr.toString());
}
